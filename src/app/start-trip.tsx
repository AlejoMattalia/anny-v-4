import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  findNodeHandle,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { searchLocations } from '@/lib/location-search';
import { sendDestinationAlert } from '@/lib/notification-service';
import { loadSettings } from '@/lib/settings-storage';
import { listenOnce, speak, stopListening } from '@/lib/voice';

type TripState =
  | 'search_start'
  | 'searching'
  | 'search_results'
  | 'trip_summary'
  | 'navigating'
  | 'nav_arrival';

interface LocationResult {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface RouteStep {
  instruction: string;
  distance: number; // meters
  duration: number; // seconds
  type: 'walking' | 'crossing' | 'bus' | 'driving' | 'arrival';
  latitude: number;
  longitude: number;
  isCorner: boolean;
  transit?: {
    lineName: string;
    vehicleName: string;
    departureStop: string;
    arrivalStop: string;
    headsign: string;
    numberOfStops: number;
    departureTime: string;
    arrivalTime: string;
  };
}

interface CalculatedRoute {
  id?: string;
  steps: RouteStep[];
  distance: number;
  duration: number;
  shape: { latitude: number; longitude: number }[];
  transitLines?: string[];
}

interface RouteResult extends CalculatedRoute {
  alternatives?: CalculatedRoute[];
}

type SimulationPhase = 'idle' | 'intro' | 'running';
type NavigationPanel = 'instruction' | 'next' | 'progress' | 'awareness';
type TravelMode = 'transit' | 'driving' | 'walking';

const TRAVEL_MODES: {
  value: TravelMode;
  label: string;
  icon: 'bus' | 'car' | 'walk';
}[] = [
  { value: 'transit', label: 'Transporte', icon: 'bus' },
  { value: 'driving', label: 'Auto', icon: 'car' },
  { value: 'walking', label: 'A pie', icon: 'walk' },
];

function getTravelModeParam(value: string | string[] | undefined): TravelMode {
  return value === 'transit' || value === 'driving' || value === 'walking'
    ? value
    : 'walking';
}

const GOOGLE_MAP_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY?.trim() ||
  (typeof Constants.expoConfig?.extra?.googleMapKey === 'string'
    ? Constants.expoConfig.extra.googleMapKey.trim()
    : '');

const INTRO_PHASE_SECONDS = 4;
const SIMULATION_STEP_MIN_SECONDS = 5;
const SIMULATION_STEP_MAX_SECONDS = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function distanceInMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const earthRadius = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceToRouteInMeters(
  position: { latitude: number; longitude: number },
  route: { latitude: number; longitude: number }[],
) {
  if (route.length === 0) return Number.POSITIVE_INFINITY;
  if (route.length === 1) return distanceInMeters(position, route[0]);

  const metersPerLatitudeDegree = 111_320;
  const metersPerLongitudeDegree =
    metersPerLatitudeDegree * Math.cos((position.latitude * Math.PI) / 180);
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const startX = (start.longitude - position.longitude) * metersPerLongitudeDegree;
    const startY = (start.latitude - position.latitude) * metersPerLatitudeDegree;
    const endX = (end.longitude - position.longitude) * metersPerLongitudeDegree;
    const endY = (end.latitude - position.latitude) * metersPerLatitudeDegree;
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
    const projection =
      segmentLengthSquared === 0
        ? 0
        : clamp(-(startX * segmentX + startY * segmentY) / segmentLengthSquared, 0, 1);
    const closestX = startX + projection * segmentX;
    const closestY = startY + projection * segmentY;
    closestDistance = Math.min(closestDistance, Math.hypot(closestX, closestY));
  }

  return closestDistance;
}

function getSimpleStepAnnouncement(step: RouteStep) {
  if (step.type === 'arrival') return 'Llegaste a tu destino.';
  if (step.transit) {
    const departureTime = step.transit.departureTime
      ? ` Sale a las ${step.transit.departureTime}.`
      : '';
    return `${step.instruction}${departureTime}`;
  }
  const distanceText = step.distance > 0 ? ` Continuá ${step.distance} metros.` : '';
  const cornerText = step.isCorner ? 'En la esquina, ' : '';
  return `${cornerText}${step.instruction}${distanceText}`;
}

function getApproachAnnouncement(step: RouteStep, distance: number) {
  const roundedDistance = distance <= 20 ? 20 : distance <= 50 ? 50 : 100;
  const cornerText = step.isCorner ? ' está la esquina.' : '.';
  return `En ${roundedDistance} metros${cornerText} ${step.instruction}`;
}

function getSimulatedStepDuration(step: RouteStep, simulationSpeed: number) {
  if (step.type === 'arrival') return 3;

  const scaledDuration = Math.round(step.duration / 10);
  const baseDuration = clamp(scaledDuration, SIMULATION_STEP_MIN_SECONDS, SIMULATION_STEP_MAX_SECONDS);
  const adjustedDuration = Math.max(2, Math.round(baseDuration / simulationSpeed));

  if (step.type === 'crossing') {
    return Math.max(adjustedDuration, 4);
  }

  return adjustedDuration;
}

// Reverse geocoding function
const fetchReverseGeocode = async (lat: number, lon: number) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=es`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AnnyApp/4.0 (contact@anny.com)',
      },
    });
    if (response.ok) {
      const data = await response.json();
      return data.display_name || 'Ubicación desconocida';
    }
  } catch (e) {
    console.warn('Error reverse geocoding:', e);
  }
  return 'Ubicación obtenida por GPS';
};

function decodePolyline(encoded: string, precision = 6) {
  const coordinates: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let byte = 0;
    let shift = 0;
    let result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({
      latitude: latitude / 10 ** precision,
      longitude: longitude / 10 ** precision,
    });
  }

  return coordinates;
}

function cleanGoogleInstruction(instruction: string) {
  return instruction
    .replace(/<div[^>]*>/gi, '. ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, 'y')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function mapGoogleTransitRoute(route: any, index: number): CalculatedRoute | null {
  const leg = route.legs?.[0];
  if (!leg?.steps?.length) return null;

  const steps: RouteStep[] = leg.steps.map((step: any) => {
    const transitDetails = step.transit_details;
    const line = transitDetails?.line;
    const vehicleName =
      line?.vehicle?.name || line?.vehicle?.type?.toLowerCase() || 'transporte público';
    const lineName = line?.short_name || line?.name || vehicleName;
    const departureStop = transitDetails?.departure_stop?.name || 'la parada indicada';
    const arrivalStop = transitDetails?.arrival_stop?.name || 'la parada indicada';
    const headsign = transitDetails?.headsign || '';
    const numberOfStops = transitDetails?.num_stops || 0;
    const isTransitStep = step.travel_mode === 'TRANSIT' && Boolean(transitDetails);
    const walkingInstruction =
      cleanGoogleInstruction(step.html_instructions || '') || 'Continuá caminando.';
    const instruction = isTransitStep
      ? `Tomá ${vehicleName} ${lineName} en ${departureStop}${headsign ? ` con dirección ${headsign}` : ''}. Bajá en ${arrivalStop}${numberOfStops > 0 ? ` después de ${numberOfStops} paradas` : ''}.`
      : walkingInstruction;

    return {
      instruction,
      distance: Math.max(0, Math.round(step.distance?.value ?? 0)),
      duration: Math.max(1, Math.round(step.duration?.value ?? 1)),
      type: isTransitStep ? 'bus' : 'walking',
      latitude: step.start_location?.lat ?? leg.start_location?.lat,
      longitude: step.start_location?.lng ?? leg.start_location?.lng,
      isCorner: /gire|girá|doble|izquierda|derecha|esquina/i.test(instruction),
      ...(isTransitStep
        ? {
            transit: {
              lineName,
              vehicleName,
              departureStop,
              arrivalStop,
              headsign,
              numberOfStops,
              departureTime: transitDetails.departure_time?.text || '',
              arrivalTime: transitDetails.arrival_time?.text || '',
            },
          }
        : {}),
    };
  });

  steps.push({
    instruction: 'Has llegado a tu destino.',
    distance: 0,
    duration: 0,
    type: 'arrival',
    latitude: leg.end_location.lat,
    longitude: leg.end_location.lng,
    isCorner: false,
  });

  const shape = route.overview_polyline?.points
    ? decodePolyline(route.overview_polyline.points, 5)
    : steps.map(({ latitude, longitude }) => ({ latitude, longitude }));
  const transitLines = Array.from(
    new Set(
      steps
        .map((step) => step.transit?.lineName)
        .filter((lineName): lineName is string => Boolean(lineName)),
    ),
  );

  return {
    id: `google-transit-${index}`,
    steps,
    distance: Math.max(0, Math.round(leg.distance?.value ?? 0)),
    duration: Math.max(0, Math.round(leg.duration?.value ?? 0)),
    shape,
    transitLines,
  };
}

function mapGoogleDrivingRoute(route: any, index: number): CalculatedRoute | null {
  const leg = route.legs?.[0];
  if (!leg?.steps?.length) return null;

  const steps: RouteStep[] = leg.steps.map((step: any) => {
    const instruction =
      cleanGoogleInstruction(step.html_instructions || '') ||
      'Continuá por la ruta indicada.';

    return {
      instruction,
      distance: Math.max(0, Math.round(step.distance?.value ?? 0)),
      duration: Math.max(1, Math.round(step.duration?.value ?? 1)),
      type: 'driving',
      latitude: step.start_location?.lat ?? leg.start_location?.lat,
      longitude: step.start_location?.lng ?? leg.start_location?.lng,
      isCorner: /gire|girá|doble|izquierda|derecha|esquina/i.test(instruction),
    };
  });

  steps.push({
    instruction: 'Has llegado a tu destino.',
    distance: 0,
    duration: 0,
    type: 'arrival',
    latitude: leg.end_location.lat,
    longitude: leg.end_location.lng,
    isCorner: false,
  });

  return {
    id: `google-driving-${index}`,
    steps,
    distance: Math.max(0, Math.round(leg.distance?.value ?? 0)),
    duration: Math.max(
      0,
      Math.round(leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0),
    ),
    shape: route.overview_polyline?.points
      ? decodePolyline(route.overview_polyline.points, 5)
      : steps.map(({ latitude, longitude }) => ({ latitude, longitude })),
  };
}

function toMercator(point: { latitude: number; longitude: number }) {
  const latitude = clamp(point.latitude, -85.0511, 85.0511);
  const sinLatitude = Math.sin((latitude * Math.PI) / 180);
  return {
    x: (point.longitude + 180) / 360,
    y: 0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI),
  };
}

function getMapViewport(
  shape: { latitude: number; longitude: number }[],
  width: number,
  height: number,
) {
  const mercatorShape = shape.map(toMercator);
  const minX = Math.min(...mercatorShape.map((point) => point.x));
  const maxX = Math.max(...mercatorShape.map((point) => point.x));
  const minY = Math.min(...mercatorShape.map((point) => point.y));
  const maxY = Math.max(...mercatorShape.map((point) => point.y));
  const availableWidth = Math.max(width - 64, 1);
  const availableHeight = Math.max(height - 90, 1);
  let zoom = 17;

  while (
    zoom > 2 &&
    ((maxX - minX) * 256 * 2 ** zoom > availableWidth ||
      (maxY - minY) * 256 * 2 ** zoom > availableHeight)
  ) {
    zoom -= 1;
  }

  return {
    zoom,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

// Real pedestrian/vehicle route fetching
const fetchRoute = async (
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
  travelMode: TravelMode,
): Promise<RouteResult> => {
  try {
    if (travelMode === 'transit') {
      const googleMapsApiKey = GOOGLE_MAP_KEY;
      if (!googleMapsApiKey) {
        throw new Error('Falta configurar la clave de Google Maps para transporte público.');
      }

      const transitParams = new URLSearchParams({
        origin: `${origin.latitude},${origin.longitude}`,
        destination: `${destination.latitude},${destination.longitude}`,
        mode: 'transit',
        alternatives: 'true',
        departure_time: 'now',
        transit_routing_preference: 'less_walking',
        language: 'es-419',
        key: googleMapsApiKey,
      });
      const transitResponse = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?${transitParams.toString()}`,
      );
      if (!transitResponse.ok) {
        throw new Error('Google no pudo calcular las opciones de transporte.');
      }

      const transitData = await transitResponse.json();
      const alternatives = (transitData.routes ?? [])
        .map(mapGoogleTransitRoute)
        .filter((route: CalculatedRoute | null): route is CalculatedRoute => Boolean(route))
        .filter((route: CalculatedRoute) => route.transitLines?.length);

      if (transitData.status !== 'OK' || alternatives.length === 0) {
        throw new Error(
          transitData.error_message ||
            'No hay recorridos de transporte público disponibles para este trayecto.',
        );
      }

      alternatives.sort((first: CalculatedRoute, second: CalculatedRoute) => {
        return first.duration - second.duration;
      });

      return {
        ...alternatives[0],
        alternatives,
      };
    }

    if (travelMode === 'driving' && Platform.OS !== 'web') {
      const googleMapsApiKey = GOOGLE_MAP_KEY;
      if (!googleMapsApiKey) {
        throw new Error('Falta configurar la clave de Google Maps para el viaje en auto.');
      }

      const drivingParams = new URLSearchParams({
        origin: `${origin.latitude},${origin.longitude}`,
        destination: `${destination.latitude},${destination.longitude}`,
        mode: 'driving',
        alternatives: 'true',
        departure_time: 'now',
        traffic_model: 'best_guess',
        language: 'es-419',
        key: googleMapsApiKey,
      });
      const drivingResponse = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?${drivingParams.toString()}`,
      );
      if (!drivingResponse.ok) {
        throw new Error('Google no pudo calcular la ruta en auto.');
      }

      const drivingData = await drivingResponse.json();
      const alternatives = (drivingData.routes ?? [])
        .map(mapGoogleDrivingRoute)
        .filter((route: CalculatedRoute | null): route is CalculatedRoute => Boolean(route));

      if (drivingData.status !== 'OK' || alternatives.length === 0) {
        throw new Error(
          drivingData.error_message || 'No hay rutas en auto disponibles para este trayecto.',
        );
      }

      alternatives.sort((first: CalculatedRoute, second: CalculatedRoute) => {
        return first.duration - second.duration;
      });

      return {
        ...alternatives[0],
        alternatives,
      };
    }

    const costing = travelMode === 'driving' ? 'auto' : 'pedestrian';
    const routeRequest = {
      locations: [
        { lat: origin.latitude, lon: origin.longitude },
        { lat: destination.latitude, lon: destination.longitude },
      ],
      costing,
      directions_options: { language: 'es-ES', units: 'kilometers' },
    };
    const url = `https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(routeRequest))}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('El servicio de rutas no pudo conectar esas direcciones.');
    const data = await response.json();
    if (!data.trip?.legs?.length) {
      throw new Error(data.error || 'No se encontró un recorrido entre esas direcciones.');
    }

    const leg = data.trip.legs[0];
    const shape = decodePolyline(leg.shape);
    const maneuvers = leg.maneuvers ?? [];
    const steps: RouteStep[] = maneuvers
      .filter((maneuver: any) => maneuver.type !== 4)
      .map((maneuver: any) => {
        const point = shape[maneuver.begin_shape_index] ?? origin;
        const instruction = maneuver.instruction || 'Continuá por la ruta indicada.';
        const type: RouteStep['type'] =
          travelMode === 'driving'
            ? 'driving'
            : instruction.toLowerCase().includes('cruce')
              ? 'crossing'
              : 'walking';

        return {
          instruction,
          distance: Math.max(0, Math.round((maneuver.length ?? 0) * 1000)),
          duration: Math.max(1, Math.round(maneuver.time ?? 1)),
          type,
          latitude: point.latitude,
          longitude: point.longitude,
          isCorner: /gire|girá|doble|izquierda|derecha|esquina/i.test(instruction),
        };
      });

    // Add arrival step
    steps.push({
      instruction: 'Has llegado a tu destino.',
      distance: 0,
      duration: 0,
      type: 'arrival',
      latitude: destination.latitude,
      longitude: destination.longitude,
      isCorner: false,
    });

    return {
      steps,
      distance: Math.round(data.trip.summary.length * 1000),
      duration: Math.round(data.trip.summary.time),
      shape,
    };
  } catch (error) {
    console.warn('Error al calcular la ruta real:', error);
    if (travelMode === 'transit') {
      if (Platform.OS === 'web' && error instanceof TypeError) {
        throw new Error(
          'El navegador no permite consultar directamente el transporte público. Podés abrir el recorrido en Google Maps.',
        );
      }
      throw error instanceof Error
        ? error
        : new Error('No se pudieron cargar las opciones de transporte público.');
    }
    if (travelMode === 'driving') {
      throw error instanceof Error
        ? error
        : new Error('No se pudo calcular la ruta en auto.');
    }
    throw new Error('No se pudo calcular la ruta real entre las direcciones seleccionadas.');
  }
};

export default function StartTripScreen() {
  const params = useLocalSearchParams();
  const isSimulationEntry = params.mode === 'simulate';
  const screenTitle = isSimulationEntry ? 'Simular viaje' : 'Iniciar viaje';
  const [travelMode, setTravelMode] = useState<TravelMode>(() =>
    getTravelModeParam(params.travelMode),
  );
  const travelModeLabel =
    travelMode === 'transit' ? 'transporte público' : travelMode === 'driving' ? 'auto' : 'a pie';

  // Route initialization parameters if pre-planned
  const initialPlannedDest = useMemo(() => {
    return params.destName && params.destLat && params.destLng
      ? {
          id: 'planned',
          name: params.destName as string,
          address: (params.destAddress as string) || '',
          latitude: parseFloat(params.destLat as string),
          longitude: parseFloat(params.destLng as string),
        }
      : null;
  }, [params.destName, params.destAddress, params.destLat, params.destLng]);

  const [state, setState] = useState<TripState>(initialPlannedDest ? 'trip_summary' : 'search_start');
  const [selectedDest, setSelectedDest] = useState<LocationResult | null>(initialPlannedDest);

  // User location and geocoded info
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [currentAddress, setCurrentAddress] = useState('Ubicación obtenida por GPS');

  // Search logic states
  const [searchQuery, setSearchQuery] = useState('');
  const [apiResults, setApiResults] = useState<LocationResult[]>([]);
  const [isSearchingResults, setIsSearchingResults] = useState(false);
  const voiceSearchSession = useRef(0);
  const lastApproachAnnouncement = useRef('');
  const hasSentDestinationAlert = useRef(false);
  const consecutiveOffRouteReadings = useRef(0);
  const reroutingInProgress = useRef(false);
  const lastRerouteStartedAt = useRef(0);
  const quickMenuTriggerRef = useRef<View>(null);
  const quickMenuFirstOptionRef = useRef<View>(null);

  // Navigation states
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [totalDistance, setTotalDistance] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [routeShape, setRouteShape] = useState<{ latitude: number; longitude: number }[]>([]);
  const [transitAlternatives, setTransitAlternatives] = useState<CalculatedRoute[]>([]);
  const [selectedTransitRouteId, setSelectedTransitRouteId] = useState('');
  const [liveDistanceToNextStep, setLiveDistanceToNextStep] = useState<number | null>(null);
  const [simulationPhase, setSimulationPhase] = useState<SimulationPhase>('idle');
  const [simulationTick, setSimulationTick] = useState(Date.now());
  const [stepStartedAt, setStepStartedAt] = useState<number | null>(null);
  const [isRecalculatingRoute, setIsRecalculatingRoute] = useState(false);

  // Overlay states
  const [showWhereAmI, setShowWhereAmI] = useState(false);
  const [showSOS, setShowSOS] = useState(false);
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [showRouteMap, setShowRouteMap] = useState(false);
  const [routeMapSize, setRouteMapSize] = useState({ width: 1, height: 1 });
  const [hasAutoStartedSimulation, setHasAutoStartedSimulation] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [destinationAlertsEnabled, setDestinationAlertsEnabled] = useState(true);
  const [notificationDistance, setNotificationDistance] = useState(400);
  const [lastAnnouncedSceneKey, setLastAnnouncedSceneKey] = useState('');

  const handleSelectTravelMode = (mode: TravelMode, label: string) => {
    if (mode === travelMode) return;
    setTravelMode(mode);
    void speak(`Modo de viaje: ${label}.`);
  };

  const focusAccessibilityElement = (element: View | null) => {
    const reactTag = element ? findNodeHandle(element) : null;
    if (reactTag) {
      AccessibilityInfo.setAccessibilityFocus(reactTag);
    }
  };

  const closeQuickMenu = () => {
    setShowQuickMenu(false);
    setTimeout(() => focusAccessibilityElement(quickMenuTriggerRef.current), 150);
  };

  const runQuickMenuAction = (action: () => void) => {
    setShowQuickMenu(false);
    setTimeout(action, 150);
  };

  const renderTravelModeSelector = () => (
    <View style={styles.travelModeSelector}>
      <Text style={styles.travelModeLabel}>Cómo querés viajar</Text>
      <View accessibilityRole="radiogroup" style={styles.travelModeRow}>
        {TRAVEL_MODES.map((mode) => {
          const isSelected = travelMode === mode.value;
          return (
            <Pressable
              accessibilityLabel={`Viajar en ${mode.label}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              key={mode.value}
              onPress={() => handleSelectTravelMode(mode.value, mode.label)}
              style={[
                styles.travelModeButton,
                isSelected && styles.travelModeButtonSelected,
              ]}
            >
              <Ionicons
                color={isSelected ? '#FFFFFF' : '#7F8A9B'}
                name={mode.icon}
                size={19}
              />
              <Text
                style={[
                  styles.travelModeButtonText,
                  isSelected && styles.travelModeButtonTextSelected,
                ]}
              >
                {mode.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  // Request GPS position on mount
  useEffect(() => {
    async function initializeGPS() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          setUserLocation(coords);
          const addressText = await fetchReverseGeocode(coords.latitude, coords.longitude);
          setCurrentAddress(addressText);
        } else {
          void speak('Permiso de ubicación denegado. Se utilizarán coordenadas por defecto para simular.');
          setUserLocation({ latitude: -34.6037, longitude: -58.3816 }); // Buenos Aires Obelisk fallback
        }
      } catch (e) {
        console.warn('GPS initialisation failed:', e);
      }
    }
    async function initializeSettings() {
      try {
        const savedSettings = await loadSettings();
        setSimulationSpeed(savedSettings.simulationSpeed);
        setDestinationAlertsEnabled(savedSettings.destinationAlertsEnabled);
        setNotificationDistance(savedSettings.notificationDistance);
      } catch {
        setSimulationSpeed(1);
        setDestinationAlertsEnabled(true);
        setNotificationDistance(400);
      }
    }

    void initializeGPS();
    void initializeSettings();
  }, []);

  const loadRoute = async (
    origin: { latitude: number; longitude: number },
    dest: LocationResult
  ) => {
    // Defer state updates to avoid React synchronous layout trigger warnings
    await new Promise((resolve) => setTimeout(resolve, 0));
    setLoadingRoute(true);
    setRouteError('');
    try {
      resetSimulation();
      const data = await fetchRoute(origin, dest, travelMode);
      setRouteSteps(data.steps);
      setTotalDistance(data.distance);
      setTotalDuration(data.duration);
      setRouteShape(data.shape);
      setTransitAlternatives(data.alternatives ?? []);
      setSelectedTransitRouteId(data.id ?? '');
      setCurrentStepIndex(0);
      setState('trip_summary');

      const distanceKm = (data.distance / 1000).toFixed(1);
      const minutes = Math.round(data.duration / 60);
      void speak(`Ruta en ${travelModeLabel} calculada hacia ${dest.name}. Distancia total de ${distanceKm} kilómetros. Tiempo aproximado de ${minutes} minutos. ¿Listo para iniciar?`);
    } catch (err) {
      console.warn(err);
      const message =
        err instanceof Error
          ? err.message
          : 'No se pudo calcular la ruta real entre las direcciones seleccionadas.';
      setRouteSteps([]);
      setTotalDistance(0);
      setTotalDuration(0);
      setRouteShape([]);
      setTransitAlternatives([]);
      setSelectedTransitRouteId('');
      setRouteError(message);
      setState('trip_summary');
      void speak(
        travelMode === 'transit'
          ? `${message} Podés abrir el recorrido de transporte público en Google Maps.`
          : `${message} Revisá tu conexión e intentá nuevamente.`,
      );
    } finally {
      setLoadingRoute(false);
    }
  };

  const retryRoute = () => {
    if (!selectedDest) return;

    const originCoords =
      params.originLat && params.originLng
        ? {
            latitude: parseFloat(params.originLat as string),
            longitude: parseFloat(params.originLng as string),
          }
        : userLocation;

    if (originCoords) {
      void loadRoute(originCoords, selectedDest);
    }
  };

  const selectTransitRoute = (route: CalculatedRoute) => {
    setRouteSteps(route.steps);
    setTotalDistance(route.distance);
    setTotalDuration(route.duration);
    setRouteShape(route.shape);
    setSelectedTransitRouteId(route.id ?? '');
    setCurrentStepIndex(0);
    setLiveDistanceToNextStep(null);

    const lines =
      route.transitLines && route.transitLines.length > 0
        ? ` Líneas: ${route.transitLines.join(', ')}.`
        : '';
    void speak(
      `Opción seleccionada. Duración aproximada de ${Math.max(1, Math.round(route.duration / 60))} minutos.${lines}`,
    );
  };

  const openGoogleDirections = async () => {
    if (!selectedDest) return;

    const originCoords =
      params.originLat && params.originLng
        ? {
            latitude: parseFloat(params.originLat as string),
            longitude: parseFloat(params.originLng as string),
          }
        : userLocation;

    if (!originCoords) {
      void speak('Todavía no pude obtener el punto de partida.');
      return;
    }

    const googleDirectionsParams = new URLSearchParams({
      api: '1',
      origin: `${originCoords.latitude},${originCoords.longitude}`,
      destination: `${selectedDest.latitude},${selectedDest.longitude}`,
      travelmode: travelMode === 'driving' ? 'driving' : 'transit',
    });
    const googleDirectionsUrl =
      `https://www.google.com/maps/dir/?${googleDirectionsParams.toString()}`;

    try {
      await Linking.openURL(googleDirectionsUrl);
      void speak(
        travelMode === 'driving'
          ? 'Abriendo la ruta en auto.'
          : 'Abriendo el recorrido de transporte público.',
      );
    } catch (error) {
      console.warn('No se pudo abrir el recorrido en Google Maps:', error);
      void speak('No pude abrir la aplicación de mapas. Intentá nuevamente.');
    }
  };

  // Compute and fetch routing if selected destination is set and user location is resolved
  useEffect(() => {
    if (state === 'navigating' || state === 'nav_arrival') {
      return;
    }

    if (selectedDest) {
      const originCoords = params.originLat && params.originLng
        ? { latitude: parseFloat(params.originLat as string), longitude: parseFloat(params.originLng as string) }
        : userLocation;

      if (originCoords) {
        const timer = setTimeout(() => {
          void loadRoute(originCoords, selectedDest);
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [selectedDest, state, userLocation, params.originLat, params.originLng, travelMode]);

  useEffect(() => {
    const shouldAutoStartSimulation =
      params.autoStartSimulation === '1' &&
      state === 'trip_summary' &&
      routeSteps.length > 0 &&
      !loadingRoute &&
      !hasAutoStartedSimulation;

    if (!shouldAutoStartSimulation) {
      return;
    }

    setHasAutoStartedSimulation(true);
    handleStartNav();
  }, [hasAutoStartedSimulation, loadingRoute, params.autoStartSimulation, routeSteps.length, state]);

  // Debounced query logic for keyboard search
  useEffect(() => {
    if (searchQuery.trim().length < 3) {
      setApiResults([]);
      setIsSearchingResults(false);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearchingResults(true);
      const results = await searchLocations(searchQuery, {
        userCoords: userLocation || undefined,
        preferredLocality: currentAddress,
      });
      setApiResults(results);
      setIsSearchingResults(false);
    }, 600);

    return () => clearTimeout(timer);
  }, [searchQuery, userLocation]);

  useEffect(() => {
    if (!isSimulationEntry || state !== 'navigating' || simulationPhase === 'idle') {
      return;
    }

    const interval = setInterval(() => {
      setSimulationTick(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [isSimulationEntry, state, simulationPhase]);

  useEffect(() => {
    if (!isSimulationEntry || state !== 'navigating' || simulationPhase !== 'intro') {
      return;
    }

    const timer = setTimeout(() => {
      setSimulationPhase('running');
      setStepStartedAt(Date.now());
      if (routeSteps[0]) {
        void speak(`Comienza el recorrido. ${getSimpleStepAnnouncement(routeSteps[0])}`);
      }
    }, INTRO_PHASE_SECONDS * 1000);

    return () => clearTimeout(timer);
  }, [isSimulationEntry, state, simulationPhase, routeSteps]);

  const handleSelectResult = (item: LocationResult) => {
    setSelectedDest(item);
  };

  const resetSimulation = () => {
    setSimulationPhase('idle');
    setStepStartedAt(null);
    setSimulationTick(Date.now());
    setLastAnnouncedSceneKey('');
    setIsRecalculatingRoute(false);
    consecutiveOffRouteReadings.current = 0;
  };

  const goToStep = (index: number, announce = true) => {
    const nextStep = routeSteps[index];
    if (!nextStep) return;

    setCurrentStepIndex(index);
    lastApproachAnnouncement.current = '';
    setLiveDistanceToNextStep(null);
    setStepStartedAt(Date.now());
    setSimulationTick(Date.now());

    if (announce) {
      const prefix =
        nextStep.type === 'crossing'
          ? 'Atención. '
          : index === 0
            ? 'Seguimos. '
            : 'Nuevo tramo. ';
      void speak(`${prefix}${getSimpleStepAnnouncement(nextStep)}`);
    }
  };

  const handleMicListening = async () => {
    const session = ++voiceSearchSession.current;
    setState('searching');
    setApiResults([]);

    try {
      const spokenDestination = await listenOnce({
        prompt: 'Escuchando. Decime a dónde querés ir.',
        timeoutMs: 12000,
        contextualStrings: ['hospital', 'plaza', 'terminal', 'aeropuerto', 'estación'],
      });

      if (session !== voiceSearchSession.current) return;

      setSearchQuery(spokenDestination);
      setIsSearchingResults(true);
      const results = await searchLocations(spokenDestination, {
        userCoords: userLocation || undefined,
        preferredLocality: currentAddress,
      });

      if (session !== voiceSearchSession.current) return;

      setApiResults(results);
      setIsSearchingResults(false);
      setState('search_results');
      void speak(
        results.length > 0
          ? `Encontré ${results.length} resultados para ${spokenDestination}.`
          : `No encontré resultados para ${spokenDestination}.`,
      );
    } catch (error) {
      if (session !== voiceSearchSession.current) return;

      const message = error instanceof Error ? error.message : 'No pude escucharte. Probá de nuevo.';
      setIsSearchingResults(false);
      setState('search_start');
      void speak(message);
    }
  };

  const handleStartNav = () => {
    if (routeSteps.length === 0) return;
    hasSentDestinationAlert.current = false;
    setState('navigating');
    setCurrentStepIndex(0);
    setSimulationPhase(isSimulationEntry ? 'intro' : 'running');
    setStepStartedAt(Date.now());
    setSimulationTick(Date.now());
    void speak(
      isSimulationEntry
        ? 'Iniciando simulación completa del viaje. Preparándote para salir.'
        : `Iniciando guía en tiempo real. ${getSimpleStepAnnouncement(routeSteps[0])}`,
    );
  };

  const handleNextStep = () => {
    const lastGuidanceIndex = Math.max(routeSteps.length - 2, 0);

    if (currentStepIndex < lastGuidanceIndex) {
      goToStep(currentStepIndex + 1);
    } else {
      resetSimulation();
      setState('nav_arrival');
      void speak('Has llegado a tu destino. Tu destino está frente a ti.');
    }
  };

  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      goToStep(currentStepIndex - 1, false);
      void speak(`Retrocediendo un tramo. ${getSimpleStepAnnouncement(routeSteps[currentStepIndex - 1])}`);
    }
  };

  const handleReturnFromArrival = () => {
    const lastGuidanceIndex = Math.max(routeSteps.length - 2, 0);
    const lastGuidanceStep = routeSteps[lastGuidanceIndex];
    if (!lastGuidanceStep) return;

    setState('navigating');
    setSimulationPhase('running');
    goToStep(lastGuidanceIndex, false);
    void speak(`Volviendo al tramo anterior. ${getSimpleStepAnnouncement(lastGuidanceStep)}`);
  };

  const speakCurrentInstruction = () => {
    if (routeSteps[currentStepIndex]) {
      void speak(getSimpleStepAnnouncement(routeSteps[currentStepIndex]));
    }
  };

  const handleWhereAmI = async () => {
    setShowWhereAmI(true);
    if (userLocation) {
      const addressText = await fetchReverseGeocode(userLocation.latitude, userLocation.longitude);
      setCurrentAddress(addressText);
      void speak(`Estás en: ${addressText}`);
    } else {
      void speak('Obteniendo información del GPS.');
    }
  };

  useEffect(() => {
    if (isSimulationEntry || state !== 'navigating' || routeSteps.length === 0) {
      return;
    }

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    const recalculateRouteFrom = async (origin: {
      latitude: number;
      longitude: number;
    }) => {
      if (
        !selectedDest ||
        reroutingInProgress.current ||
        Date.now() - lastRerouteStartedAt.current < 15_000
      ) {
        return;
      }

      reroutingInProgress.current = true;
      lastRerouteStartedAt.current = Date.now();
      consecutiveOffRouteReadings.current = 0;
      setIsRecalculatingRoute(true);
      void speak('Te desviaste del camino. Calculando una nueva ruta.');

      try {
        const data = await fetchRoute(origin, selectedDest, travelMode);
        if (cancelled) return;

        setRouteSteps(data.steps);
        setTotalDistance(data.distance);
        setTotalDuration(data.duration);
        setRouteShape(data.shape);
        setTransitAlternatives(data.alternatives ?? []);
        setSelectedTransitRouteId(data.id ?? '');
        setCurrentStepIndex(0);
        setLiveDistanceToNextStep(null);
        lastApproachAnnouncement.current = '';
        setStepStartedAt(Date.now());
        setSimulationTick(Date.now());

        const firstStep = data.steps[0];
        void speak(
          firstStep
            ? `Ruta recalculada. ${getSimpleStepAnnouncement(firstStep)}`
            : 'Ruta recalculada.',
        );
      } catch (error) {
        console.warn('No se pudo recalcular la ruta después del desvío:', error);
        if (!cancelled) {
          void speak(
            'No pude calcular una nueva ruta. Seguiré intentando mientras avanzás.',
          );
        }
      } finally {
        reroutingInProgress.current = false;
        if (!cancelled) {
          setIsRecalculatingRoute(false);
        }
      }
    };

    void Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 2000,
        distanceInterval: 3,
      },
      (position) => {
        if (cancelled) return;

        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setUserLocation(coords);
        setSimulationTick(Date.now());

        if (reroutingInProgress.current) {
          return;
        }

        const gpsAccuracy = position.coords.accuracy ?? 20;
        const offRouteThreshold = Math.max(
          travelMode === 'walking' ? 35 : travelMode === 'driving' ? 55 : 65,
          gpsAccuracy * 2,
        );
        const routeDistance = distanceToRouteInMeters(coords, routeShape);
        const hasReliablePosition = gpsAccuracy <= 80 && routeShape.length > 1;

        if (hasReliablePosition && routeDistance > offRouteThreshold) {
          consecutiveOffRouteReadings.current += 1;
        } else {
          consecutiveOffRouteReadings.current = 0;
        }

        if (
          consecutiveOffRouteReadings.current >= 2 &&
          !reroutingInProgress.current
        ) {
          void recalculateRouteFrom(coords);
          return;
        }

        const targetIndex = Math.min(currentStepIndex + 1, routeSteps.length - 1);
        const targetStep = routeSteps[targetIndex];
        if (!targetStep) return;

        const distance = distanceInMeters(coords, targetStep);
        setLiveDistanceToNextStep(Math.round(distance));

        const arrivalThreshold = clamp(position.coords.accuracy ?? 20, 15, 35);
        if (distance > arrivalThreshold) {
          const isDestinationStep =
            targetStep.type === 'arrival' || targetIndex === routeSteps.length - 1;

          if (
            destinationAlertsEnabled &&
            isDestinationStep &&
            distance <= notificationDistance &&
            !hasSentDestinationAlert.current
          ) {
            hasSentDestinationAlert.current = true;
            const roundedDistance = Math.max(20, Math.round(distance / 10) * 10);
            const destinationName =
              targetStep.transit?.arrivalStop || selectedDest?.name || '';
            void speak(
              `Atención. ${destinationName ? `${destinationName} está` : 'Tu destino está'} a aproximadamente ${roundedDistance} metros. Preparáte para llegar.`,
            );
            void sendDestinationAlert(destinationName, roundedDistance);
          }

          const announcementDistance =
            distance <= 20 ? 20 : distance <= 50 ? 50 : distance <= 100 ? 100 : null;
          const announcementKey = `${targetIndex}-${announcementDistance}`;
          if (
            announcementDistance !== null &&
            lastApproachAnnouncement.current !== announcementKey
          ) {
            lastApproachAnnouncement.current = announcementKey;
            void speak(getApproachAnnouncement(targetStep, announcementDistance));
          }
          return;
        }

        if (targetStep.type === 'arrival' || targetIndex === routeSteps.length - 1) {
          setState('nav_arrival');
          setLiveDistanceToNextStep(0);
          void speak('Has llegado a tu destino.');
          return;
        }

        goToStep(targetIndex);
      },
    ).then((nextSubscription) => {
      if (cancelled) {
        nextSubscription.remove();
      } else {
        subscription = nextSubscription;
      }
    }).catch((error) => {
      console.warn('No se pudo iniciar el seguimiento GPS:', error);
      if (!cancelled) {
        void speak('No puedo actualizar el recorrido sin acceso al GPS.');
      }
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [
    currentStepIndex,
    destinationAlertsEnabled,
    isSimulationEntry,
    notificationDistance,
    routeShape,
    routeSteps,
    selectedDest,
    state,
    travelMode,
  ]);

  // Compute remaining distance & duration dynamically
  const remainingDistance = useMemo(() => {
    const remainingAfterCurrent = routeSteps
      .slice(currentStepIndex + 1)
      .reduce((sum, step) => sum + step.distance, 0);
    return isSimulationEntry || liveDistanceToNextStep === null
      ? routeSteps.slice(currentStepIndex).reduce((sum, step) => sum + step.distance, 0)
      : liveDistanceToNextStep + remainingAfterCurrent;
  }, [currentStepIndex, isSimulationEntry, liveDistanceToNextStep, routeSteps]);

  const remainingDuration = useMemo(() => {
    if (!isSimulationEntry && totalDistance > 0) {
      return Math.max(0, Math.round(totalDuration * (remainingDistance / totalDistance)));
    }
    return routeSteps.slice(currentStepIndex).reduce((sum, step) => sum + step.duration, 0);
  }, [
    currentStepIndex,
    isSimulationEntry,
    remainingDistance,
    routeSteps,
    totalDistance,
    totalDuration,
  ]);

  const currentStep = routeSteps[currentStepIndex] || null;
  const nextStep = routeSteps[currentStepIndex + 1] || null;
  const stepElapsedSeconds = stepStartedAt ? Math.max(0, Math.floor((simulationTick - stepStartedAt) / 1000)) : 0;
  const simulatedStepDuration = currentStep ? getSimulatedStepDuration(currentStep, simulationSpeed) : 0;
  const introCountdown = simulationPhase === 'intro'
    ? Math.max(1, INTRO_PHASE_SECONDS - stepElapsedSeconds)
    : 0;
  const simulationProgress = simulatedStepDuration > 0
    ? Math.min(stepElapsedSeconds / simulatedStepDuration, 1)
    : 0;
  const liveStepProgress =
    !isSimulationEntry && currentStep?.distance && liveDistanceToNextStep !== null
      ? clamp(1 - liveDistanceToNextStep / currentStep.distance, 0, 1)
      : 0;
  const currentStepProgress = isSimulationEntry ? simulationProgress : liveStepProgress;
  const overallProgress = routeSteps.length > 1
    ? Math.min((currentStepIndex + currentStepProgress) / Math.max(routeSteps.length - 1, 1), 1)
    : 0;
  const simulatedShapePosition = (() => {
    if (!isSimulationEntry || routeShape.length === 0) return null;
    const shapePosition = overallProgress * (routeShape.length - 1);
    const startIndex = Math.floor(shapePosition);
    const endIndex = Math.min(startIndex + 1, routeShape.length - 1);
    const segmentProgress = shapePosition - startIndex;
    const start = routeShape[startIndex];
    const end = routeShape[endIndex];
    return {
      latitude: start.latitude + (end.latitude - start.latitude) * segmentProgress,
      longitude: start.longitude + (end.longitude - start.longitude) * segmentProgress,
    };
  })();
  const displayedMapPosition =
    simulatedShapePosition ?? userLocation ?? routeShape[0] ?? null;
  const mapSampleRate = Math.max(1, Math.ceil(routeShape.length / 70));
  const sampledRouteShape = routeShape.filter(
    (_, index) => index % mapSampleRate === 0 || index === routeShape.length - 1,
  );
  const mapViewport =
    routeShape.length > 0
      ? getMapViewport(routeShape, routeMapSize.width, routeMapSize.height)
      : { zoom: 15, centerX: 0.5, centerY: 0.5 };
  const mapWorldSize = 256 * 2 ** mapViewport.zoom;
  const projectMapPoint = (point: { latitude: number; longitude: number }) => {
    const projected = toMercator(point);
    return {
      x: (projected.x - mapViewport.centerX) * mapWorldSize + routeMapSize.width / 2,
      y: (projected.y - mapViewport.centerY) * mapWorldSize + routeMapSize.height / 2,
    };
  };
  const projectedRoute = sampledRouteShape.map(projectMapPoint);
  const projectedMapPosition =
    displayedMapPosition && routeShape.length > 0
      ? projectMapPoint(displayedMapPosition)
      : null;
  const centerPixelX = mapViewport.centerX * mapWorldSize;
  const centerPixelY = mapViewport.centerY * mapWorldSize;
  const firstTileX = Math.floor((centerPixelX - routeMapSize.width / 2) / 256) - 1;
  const lastTileX = Math.floor((centerPixelX + routeMapSize.width / 2) / 256) + 1;
  const firstTileY = Math.floor((centerPixelY - routeMapSize.height / 2) / 256) - 1;
  const lastTileY = Math.floor((centerPixelY + routeMapSize.height / 2) / 256) + 1;
  const tileCount = 2 ** mapViewport.zoom;
  const mapTiles: { key: string; url: string; left: number; top: number }[] = [];
  for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
    for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tileCount) continue;
      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      mapTiles.push({
        key: `${mapViewport.zoom}-${tileX}-${tileY}`,
        url: `https://a.basemaps.cartocdn.com/light_all/${mapViewport.zoom}/${wrappedTileX}/${tileY}.png`,
        left: tileX * 256 - centerPixelX + routeMapSize.width / 2,
        top: tileY * 256 - centerPixelY + routeMapSize.height / 2,
      });
    }
  }
  const activeNavPanel: NavigationPanel = 'instruction';
  const showInlineSearchResults =
    state === 'search_start' && (searchQuery.trim().length > 0 || isSearchingResults || apiResults.length > 0);

  useEffect(() => {
    if (!isSimulationEntry || state !== 'navigating' || simulationPhase !== 'running' || !currentStep) {
      return;
    }

    const sceneKey = `${currentStepIndex}-${activeNavPanel}`;
    if (sceneKey === lastAnnouncedSceneKey) {
      return;
    }

    setLastAnnouncedSceneKey(sceneKey);

    if (activeNavPanel === 'progress') {
      const distanceText =
        remainingDistance > 1000
          ? `${(remainingDistance / 1000).toFixed(1)} kilometros restantes`
          : `${remainingDistance} metros restantes`;
      void speak(
        `Progreso del viaje. Vas por el tramo ${currentStepIndex + 1} de ${Math.max(routeSteps.length - 1, 1)}. Quedan ${distanceText} y aproximadamente ${Math.max(1, Math.round(remainingDuration / 60))} minutos.`
      );
      return;
    }

    if (activeNavPanel === 'next' && nextStep) {
      void speak(`Despues de este tramo, sigue: ${nextStep.instruction}`);
      return;
    }

    if (activeNavPanel === 'awareness') {
      void speak(
        currentStep.type === 'crossing'
          ? 'Atencion al entorno. Estas en una zona de cruce, avanzando con precaucion.'
          : 'Entorno estable. Mantene el rumbo mientras continuo guiandote.'
      );
    }
  }, [
    activeNavPanel,
    currentStep,
    currentStepIndex,
    isSimulationEntry,
    lastAnnouncedSceneKey,
    nextStep,
    remainingDistance,
    remainingDuration,
    routeSteps.length,
    simulationPhase,
    state,
  ]);

  useEffect(() => {
    if (!isSimulationEntry || state !== 'navigating' || simulationPhase !== 'running' || !currentStep) {
      return;
    }

    const lastGuidanceIndex = Math.max(routeSteps.length - 2, 0);
    if (stepElapsedSeconds < simulatedStepDuration) {
      return;
    }

    if (currentStepIndex >= lastGuidanceIndex) {
      resetSimulation();
      setState('nav_arrival');
      void speak('Has llegado a tu destino. Tu destino está frente a ti.');
      return;
    }

    goToStep(currentStepIndex + 1);
  }, [
    currentStep,
    currentStepIndex,
    isSimulationEntry,
    routeSteps,
    simulatedStepDuration,
    simulationPhase,
    state,
    stepElapsedSeconds,
  ]);

  const renderSearchResults = () => (
    <>
      <Text style={styles.sectionHeader}>Resultados</Text>

      {isSearchingResults ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#6A29FF" size="large" />
          <Text style={{ color: '#7F8A9B', marginTop: 12, fontWeight: '800' }}>Buscando ubicaciones...</Text>
        </View>
      ) : (
        <FlatList
          data={apiResults}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.resultsList}
          ListEmptyComponent={
            <View style={{ flex: 1, paddingVertical: 40, alignItems: 'center' }}>
              <Text style={{ color: '#7F8A9B', fontWeight: '800' }}>
                {searchQuery.trim().length < 3
                  ? 'Escribe al menos 3 caracteres...'
                  : 'No se encontraron resultados.'}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <Pressable
              accessibilityLabel={`${item.name}. ${item.address}`}
              onPress={() => handleSelectResult(item)}
              style={[styles.resultCard, index === 0 && styles.resultCardHighlighted]}
            >
              <View style={styles.resultTextWrapper}>
                <Text style={styles.resultName}>{item.name}</Text>
                <Text numberOfLines={2} style={styles.resultAddress}>{item.address}</Text>
              </View>
              <Ionicons
                color={index === 0 ? '#B18CFF' : '#596474'}
                name="chevron-forward"
                size={20}
              />
            </Pressable>
          )}
        />
      )}
    </>
  );

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        {['search_start', 'searching', 'search_results', 'trip_summary'].includes(state) && (
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="Volver"
              onPress={() => {
                if (state === 'trip_summary' && !initialPlannedDest) {
                  setState('search_start');
                } else if (state === 'search_results') {
                  setState('search_start');
                  setSearchQuery('');
                } else {
                  router.replace('/travel');
                }
              }}
              style={styles.backButton}
            >
              <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
            </Pressable>
            <Text style={styles.headerTitle}>{screenTitle}</Text>
          </View>
        )}

        {/* 1. START SCREEN */}
        {state === 'search_start' && (
          <View style={showInlineSearchResults ? styles.flexContainer : styles.contentCenter}>
            <View style={styles.logoRow}>
              <MaterialCommunityIcons color="#B18CFF" name="triangle" size={20} />
              <Text style={styles.logoText}>ANNY</Text>
            </View>

            <Text style={styles.mainPrompt}>¿A dónde quieres ir?</Text>

            {renderTravelModeSelector()}

            {/* Real Search Input Box */}
            <View style={styles.searchInputContainer}>
              <Ionicons color="#7F8A9B" name="search" size={20} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Escribe tu destino..."
                placeholderTextColor="#7F8A9B"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')}>
                  <Ionicons color="#7F8A9B" name="close-circle" size={18} />
                </Pressable>
              )}
            </View>

            {showInlineSearchResults && renderSearchResults()}

            <Pressable
              accessibilityLabel="Presiona para buscar destino por voz"
              onPress={handleMicListening}
              style={styles.micButtonContainer}
            >
              <View style={styles.micOuterRing}>
                <View style={styles.micInnerBg}>
                  <Ionicons color="#FFFFFF" name="mic" size={44} />
                </View>
              </View>
            </Pressable>

            <Text style={styles.subPrompt}>Presiona el micrófono para hablar</Text>

            <View style={styles.startActions}>
              <Pressable
                accessibilityLabel="Ir a mis lugares guardados"
                onPress={() =>
                  router.push({
                    pathname: '/saved-locations',
                    params: {
                      selectForTrip: '1',
                      mode: isSimulationEntry ? 'simulate' : 'start',
                      travelMode,
                    },
                  })
                }
                style={styles.startActionBtn}
              >
                <Ionicons color="#FFFFFF" name="star-outline" size={18} />
                <Text style={styles.startActionText}>Mis lugares</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Ir a viajes guardados"
                onPress={() =>
                  router.push({
                    pathname: '/saved-trips',
                    params: { mode: isSimulationEntry ? 'simulate' : 'start' },
                  })
                }
                style={styles.startActionBtn}
              >
                <MaterialCommunityIcons color="#FFFFFF" name="folder-heart-outline" size={18} />
                <Text style={styles.startActionText}>Viajes guardados</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Abrir ayuda"
                onPress={() => setShowSOS(true)}
                style={styles.startActionBtn}
              >
                <Ionicons color="#FFFFFF" name="help-buoy-outline" size={18} />
                <Text style={styles.startActionText}>Ayuda</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* 2. SEARCHING STATE */}
        {state === 'searching' && (
          <View style={styles.contentCenter}>
            <Text style={styles.searchingTitle}>Escuchando...</Text>

            <View style={styles.pulseContainer}>
              <View style={[styles.pulseCircle, styles.pulseCircleLarge]} />
              <View style={[styles.pulseCircle, styles.pulseCircleMedium]} />
              <View style={styles.pulseInnerBg}>
                <Ionicons color="#B18CFF" name="mic" size={44} />
              </View>
            </View>

            <View style={styles.suggestionsBox}>
              <Text style={styles.suggestionsHeader}>Puedes decir por ejemplo:</Text>
              <Text style={styles.suggestionItem}>• Hospital Italiano</Text>
              <Text style={styles.suggestionItem}>• Plaza de Mayo</Text>
              <Text style={styles.suggestionItem}>• Obelisco</Text>
            </View>

            <Pressable
              accessibilityLabel="Cancelar búsqueda por voz"
              onPress={() => {
                voiceSearchSession.current += 1;
                stopListening();
                setState('search_start');
                setSearchQuery('');
              }}
              style={styles.cancelSearchBtn}
            >
              <Ionicons color="#7F8A9B" name="close" size={20} />
              <Text style={styles.cancelSearchText}>Cancelar</Text>
            </Pressable>
          </View>
        )}

        {/* 3. SEARCH RESULTS */}
        {state === 'search_results' && (
          <View style={styles.flexContainer}>
            {/* Real Search Input Box */}
            <View style={styles.searchInputContainer}>
              <Ionicons color="#7F8A9B" name="search" size={20} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Escribe tu destino..."
                placeholderTextColor="#7F8A9B"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')}>
                  <Ionicons color="#7F8A9B" name="close-circle" size={18} />
                </Pressable>
              )}
            </View>

            {renderSearchResults()}

            <Pressable
              onPress={() => {
                setState('search_start');
                setSearchQuery('');
              }}
              style={styles.searchAgainBtn}
            >
              <Ionicons color="#FFFFFF" name="mic-outline" size={18} />
              <Text style={styles.searchAgainText}>Buscar por voz</Text>
            </Pressable>
          </View>
        )}

        {/* 4. TRIP SUMMARY */}
        {state === 'trip_summary' && selectedDest && (
          <View style={styles.flexContainer}>
            <Text style={styles.sectionHeader}>Resumen del viaje</Text>

            <View style={styles.destinationSummaryCard}>
              <View style={styles.summaryDestIcon}>
                <Ionicons color="#B18CFF" name="location" size={22} />
              </View>
              <View style={styles.summaryDestInfo}>
                <Text style={styles.summaryDestName}>{selectedDest.name}</Text>
                <Text numberOfLines={2} style={styles.summaryDestAddr}>{selectedDest.address}</Text>
              </View>
            </View>

            {renderTravelModeSelector()}

            {loadingRoute ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator color="#6A29FF" size="large" />
                <Text style={{ color: '#7F8A9B', marginTop: 12, fontWeight: '800' }}>
                  Calculando mejor ruta en {travelModeLabel}...
                </Text>
              </View>
            ) : routeError ? (
              <View style={styles.routeErrorCard}>
                <Ionicons
                  color={travelMode === 'transit' ? '#208AEF' : '#FF4E72'}
                  name={travelMode === 'transit' ? 'bus-outline' : 'warning-outline'}
                  size={34}
                />
                <Text style={styles.routeErrorTitle}>
                  {travelMode === 'transit'
                    ? 'Abrir recorrido de transporte público'
                    : 'No se pudo cargar la ruta real'}
                </Text>
                <Text style={styles.routeErrorText}>{routeError}</Text>
                {travelMode === 'transit' && (
                  <Pressable
                    accessibilityLabel="Abrir recorrido de transporte público en Google Maps"
                    onPress={openGoogleDirections}
                    style={styles.retryRouteButton}
                  >
                    <Ionicons color="#FFFFFF" name="map-outline" size={18} />
                    <Text style={styles.retryRouteButtonText}>Abrir transporte público</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityLabel="Reintentar calcular ruta"
                  onPress={retryRoute}
                  style={[
                    styles.retryRouteButton,
                    travelMode === 'transit' && styles.retryRouteSecondaryButton,
                  ]}
                >
                  <Ionicons color="#FFFFFF" name="refresh" size={18} />
                  <Text style={styles.retryRouteButtonText}>Reintentar</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.summaryLabel}>Recorrido recomendado</Text>
                {travelMode === 'transit' && transitAlternatives.length > 1 && (
                  <View style={styles.transitAlternatives}>
                    <Text style={styles.transitAlternativesTitle}>
                      {transitAlternatives.length} opciones disponibles
                    </Text>
                    <ScrollView
                      contentContainerStyle={styles.transitAlternativesList}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      {transitAlternatives.map((route, index) => {
                        const isSelected = route.id === selectedTransitRouteId;
                        return (
                          <Pressable
                            accessibilityLabel={`Opción ${index + 1}. ${Math.max(1, Math.round(route.duration / 60))} minutos. Líneas ${route.transitLines?.join(', ') || 'disponibles'}`}
                            key={route.id}
                            onPress={() => selectTransitRoute(route)}
                            style={[
                              styles.transitAlternativeCard,
                              isSelected && styles.transitAlternativeCardSelected,
                            ]}
                          >
                            <View style={styles.transitAlternativeHeader}>
                              <Text style={styles.transitAlternativeName}>
                                Opción {index + 1}
                              </Text>
                              {isSelected && (
                                <Ionicons color="#4DAA57" name="checkmark-circle" size={18} />
                              )}
                            </View>
                            <Text style={styles.transitAlternativeTime}>
                              {Math.max(1, Math.round(route.duration / 60))} min ·{' '}
                              {route.distance > 1000
                                ? `${(route.distance / 1000).toFixed(1)} km`
                                : `${route.distance} m`}
                            </Text>
                            <View style={styles.transitLinesRow}>
                              {route.transitLines?.map((lineName) => (
                                <View key={`${route.id}-${lineName}`} style={styles.transitLineBadge}>
                                  <Ionicons color="#FFFFFF" name="bus-outline" size={13} />
                                  <Text style={styles.transitLineBadgeText}>{lineName}</Text>
                                </View>
                              ))}
                            </View>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
                <View style={styles.routeOptionCard}>
                  <View style={styles.routePathRow}>
                    <View style={styles.routeSegment}>
                      <Ionicons
                        color="#4DAA57"
                        name={travelMode === 'transit' ? 'bus' : travelMode === 'driving' ? 'car' : 'walk'}
                        size={18}
                      />
                      <Text style={styles.routeSegmentLabel}>
                        {travelMode === 'transit' ? 'Transporte' : travelMode === 'driving' ? 'Auto' : 'A pie'}
                      </Text>
                      <Text style={styles.routeSegmentSub}>
                        {totalDistance > 1000 ? `${(totalDistance / 1000).toFixed(1)} km` : `${totalDistance} m`}
                      </Text>
                    </View>
                    <Ionicons color="#596474" name="arrow-forward" size={16} />
                    <View style={styles.routeSegment}>
                      <Ionicons color="#208AEF" name="compass-outline" size={18} />
                      <Text style={styles.routeSegmentLabel}>Guía por Voz</Text>
                      <Text style={styles.routeSegmentSub}>{routeSteps.length} pasos</Text>
                    </View>
                  </View>

                  <View style={styles.summaryDivider} />

                  <View style={styles.summaryStatsRow}>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>Tiempo estimado</Text>
                      <Text style={styles.statValue}>{Math.round(totalDuration / 60)} min</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>Distancia total</Text>
                      <Text style={styles.statValue}>
                        {totalDistance > 1000 ? `${(totalDistance / 1000).toFixed(1)} km` : `${totalDistance} m`}
                      </Text>
                    </View>
                  </View>
                  {travelMode !== 'walking' && (
                    <Text style={styles.googleMapsAttribution}>
                      {travelMode === 'transit'
                        ? 'Datos de transporte: Google Maps'
                        : Platform.OS === 'web'
                          ? 'Ruta en auto: OpenStreetMap'
                          : 'Rutas y tráfico: Google Maps'}
                    </Text>
                  )}
                </View>

                <Pressable onPress={handleStartNav} style={styles.startNavButton}>
                  <MaterialCommunityIcons color="#FFFFFF" name="navigation" size={22} />
                  <Text style={styles.startNavButtonText}>{screenTitle}</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* 5. ACTIVE NAVIGATION */}
        {state === 'navigating' && currentStep && (
          <View style={styles.flexContainer}>
            {/* Dynamic Step Header */}
            <View
              style={[
                styles.stepHeader,
                simulationPhase === 'intro'
                  ? styles.headerWaiting
                  : currentStep.type === 'crossing'
                    ? styles.headerCrossing
                    : styles.headerWalking,
              ]}
            >
              <Ionicons
                color="#FFFFFF"
                name={
                  simulationPhase === 'intro'
                    ? 'time-outline'
                    : currentStep.type === 'crossing'
                      ? 'warning-outline'
                      : currentStep.type === 'bus'
                        ? 'bus'
                        : currentStep.type === 'driving'
                          ? 'car'
                          : 'walk'
                }
                size={20}
              />
              <Text style={styles.stepHeaderTitle}>
                {simulationPhase === 'intro'
                  ? 'Preparando salida'
                  : currentStep.type === 'crossing'
                    ? 'Cruce peatonal'
                    : travelMode === 'transit'
                      ? 'En transporte'
                      : travelMode === 'driving'
                        ? 'Conduciendo'
                        : 'Caminando'}
              </Text>
            </View>

            <View style={styles.simulationStatusCard}>
              <View style={styles.simulationStatusRow}>
                <Text style={styles.simulationStatusLabel}>
                  {isRecalculatingRoute
                    ? 'Recalculando ruta'
                    : simulationPhase === 'intro'
                      ? 'Listo para comenzar'
                      : isSimulationEntry
                        ? 'Simulación en curso'
                        : 'Navegación GPS en tiempo real'}
                </Text>
                <Text style={styles.simulationStatusValue}>
                  {Math.round(overallProgress * 100)}%
                </Text>
              </View>
              <View style={styles.simulationProgressTrack}>
                <View style={[styles.simulationProgressFill, { width: `${Math.max(overallProgress * 100, 4)}%` }]} />
              </View>
              <Text style={styles.simulationStatusHint}>
                {isRecalculatingRoute
                  ? 'Detectamos un desvío. Buscando el mejor camino desde tu ubicación...'
                  : simulationPhase === 'intro'
                    ? `La guía arranca en ${introCountdown} s`
                    : isSimulationEntry
                      ? `Tramo ${currentStepIndex + 1} de ${Math.max(routeSteps.length - 1, 1)}`
                      : liveDistanceToNextStep === null
                        ? 'Esperando una posición GPS precisa...'
                        : `Próxima indicación en ${liveDistanceToNextStep} m`}
              </Text>
            </View>

            {/* Instruction body containing central directive circle */}
            <View style={styles.instructionContainer}>
              {simulationPhase === 'intro' ? (
                <View style={styles.simulationSceneCard}>
                  <View style={[styles.directiveCircle, styles.circleBlue]}>
                    <Text style={styles.simulationCountdownText}>{introCountdown}</Text>
                  </View>
                  <Text style={styles.navDirectiveText}>Preparando tu salida</Text>
                  <Text style={styles.navDirectiveSub}>
                    Vamos a iniciar la guía paso a paso y cambiar la vista automáticamente durante el recorrido.
                  </Text>
                </View>
              ) : activeNavPanel === 'instruction' ? (
                <View style={styles.simulationSceneCard}>
                  <View
                    style={[
                      styles.directiveCircle,
                      currentStep.type === 'crossing' ? styles.circleYellow : styles.circleGreen,
                    ]}
                  >
                    <Ionicons
                      color="#FFFFFF"
                      name={currentStep.type === 'crossing' ? 'alert-circle-outline' : 'arrow-up'}
                      size={54}
                    />
                  </View>
                  <Text style={styles.navDirectiveText}>{currentStep.instruction}</Text>
                  {currentStep.transit ? (
                    <View style={styles.activeTransitDetails}>
                      <View style={styles.transitLineBadge}>
                        <Ionicons color="#FFFFFF" name="bus-outline" size={14} />
                        <Text style={styles.transitLineBadgeText}>
                          {currentStep.transit.lineName}
                        </Text>
                      </View>
                      <Text style={styles.navDirectiveSub}>
                        Salida {currentStep.transit.departureTime || 'según el horario disponible'}
                        {currentStep.transit.arrivalTime
                          ? ` · Llegada ${currentStep.transit.arrivalTime}`
                          : ''}
                      </Text>
                    </View>
                  ) : currentStep.distance > 0 && (
                    <Text style={styles.navDirectiveSub}>
                      {travelMode === 'walking' ? 'Avanzá' : 'Continuá'} {currentStep.distance} metros durante este tramo
                    </Text>
                  )}
                </View>
              ) : activeNavPanel === 'next' ? (
                <View style={styles.infoSceneCard}>
                  <View style={styles.infoSceneHeader}>
                    <Ionicons color="#B18CFF" name="arrow-forward-circle-outline" size={20} />
                    <Text style={styles.infoSceneLabel}>Lo que sigue</Text>
                  </View>
                  <Text style={styles.infoSceneTitle}>
                    {nextStep ? 'Próxima indicación' : 'Último tramo'}
                  </Text>
                  <Text style={styles.infoSceneBody}>
                    {nextStep
                      ? nextStep.instruction
                      : 'Cuando completes este tramo vas a entrar automáticamente en la vista de llegada.'}
                  </Text>
                </View>
              ) : activeNavPanel === 'progress' ? (
                <View style={styles.infoSceneCard}>
                  <View style={styles.infoSceneHeader}>
                    <Ionicons color="#4DAA57" name="analytics-outline" size={20} />
                    <Text style={styles.infoSceneLabel}>Progreso del viaje</Text>
                  </View>
                  <Text style={styles.infoSceneTitle}>
                    {remainingDistance > 1000
                      ? `${(remainingDistance / 1000).toFixed(1)} km restantes`
                      : `${remainingDistance} m restantes`}
                  </Text>
                  <Text style={styles.infoSceneBody}>
                    Tiempo estimado restante: {Math.max(1, Math.round(remainingDuration / 60))} min.
                    La simulación avanza sola según la duración de cada tramo.
                  </Text>
                </View>
              ) : (
                <View style={styles.infoSceneCard}>
                  <View style={styles.infoSceneHeader}>
                    <Ionicons color="#208AEF" name="eye-outline" size={20} />
                    <Text style={styles.infoSceneLabel}>Lectura del entorno</Text>
                  </View>
                  <Text style={styles.infoSceneTitle}>
                    {currentStep.type === 'crossing' ? 'Atención al cruce' : 'Recorrido estable'}
                  </Text>
                  <Text style={styles.infoSceneBody}>
                    {currentStep.type === 'crossing'
                      ? 'Reduce la marcha, buscá la senda peatonal y esperá indicaciones de cruce seguro.'
                      : 'Mantén el rumbo y seguí la guía por voz. La vista va a alternar entre instrucción, progreso y próximos pasos.'}
                  </Text>
                </View>
              )}
            </View>

            {/* Navigation Footer Stats */}
            <View style={styles.navFooterStats}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Tiempo restante</Text>
                <Text style={styles.statValue}>{Math.round(remainingDuration / 60)} min</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Distancia restante</Text>
                <Text style={styles.statValue}>
                  {remainingDistance > 1000 ? `${(remainingDistance / 1000).toFixed(1)} km` : `${remainingDistance} m`}
                </Text>
              </View>
            </View>

            {/* Active Buttons Row */}
            <View style={styles.navActionsRow}>
              <Pressable
                accessibilityLabel="¿Dónde estoy?"
                onPress={handleWhereAmI}
                style={styles.navActionOutlineBtn}
              >
                <Text style={styles.navActionOutlineText}>¿Dónde estoy?</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="SOS Ayuda"
                onPress={() => setShowSOS(true)}
                style={[styles.navActionOutlineBtn, styles.navActionSOSBtn]}
              >
                <Text style={[styles.navActionOutlineText, styles.navActionSOSText]}>Ayuda</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Escuchar instrucción de nuevo"
                onPress={speakCurrentInstruction}
                style={styles.navAudioReplayBtn}
              >
                <Ionicons color="#FFFFFF" name="volume-high" size={20} />
              </Pressable>
            </View>

            {/* Quick Menu Button Trigger */}
            <Pressable
              accessibilityLabel={
                travelMode !== 'walking'
                  ? `Ver ${travelMode === 'driving' ? 'ruta en auto' : 'transporte público'} en Google Maps`
                  : 'Ver mapa del trayecto'
              }
              onPress={
                travelMode !== 'walking'
                  ? openGoogleDirections
                  : () => setShowRouteMap(true)
              }
              style={styles.routeMapTriggerBtn}
            >
              <Ionicons color="#FFFFFF" name="map-outline" size={22} />
              <Text style={styles.routeMapTriggerText}>
                {travelMode !== 'walking'
                  ? `Ver ${travelMode === 'driving' ? 'ruta' : 'transporte'} en Google Maps`
                  : 'Ver mapa y trayecto'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityLabel="Abrir menú rápido de navegación"
              accessibilityHint="Abre una ventana con opciones de navegación en una lista vertical"
              accessibilityRole="button"
              accessibilityState={{ expanded: showQuickMenu }}
              onPress={() => setShowQuickMenu(true)}
              ref={quickMenuTriggerRef}
              style={styles.quickMenuTriggerBtn}
            >
              <Ionicons color="#FFFFFF" name="menu" size={22} />
              <Text style={styles.quickMenuTriggerText}>Menú rápido</Text>
            </Pressable>

            {/* Manual controls are always available in case GPS or a route step gets stuck. */}
            <View style={styles.navigationControlBar}>
              <Pressable
                accessibilityLabel="Volver a la indicación anterior"
                disabled={currentStepIndex === 0 || simulationPhase === 'intro'}
                onPress={handlePrevStep}
                style={[
                  styles.navigationStepBtn,
                  (currentStepIndex === 0 || simulationPhase === 'intro') &&
                    styles.navigationStepBtnDisabled,
                ]}
              >
                <Ionicons color="#FFFFFF" name="chevron-back" size={16} />
                <Text style={styles.navigationStepBtnText}>Anterior</Text>
              </Pressable>
              <Text
                accessibilityLabel={`Indicación ${currentStepIndex + 1} de ${Math.max(routeSteps.length - 1, 1)}`}
                style={styles.navigationStepIndicator}
              >
                {simulationPhase === 'intro'
                  ? 'Preparando'
                  : `${currentStepIndex + 1} / ${Math.max(routeSteps.length - 1, 1)}`}
              </Text>
              <Pressable
                accessibilityLabel="Ir a la indicación siguiente"
                disabled={simulationPhase === 'intro'}
                onPress={handleNextStep}
                style={[
                  styles.navigationStepBtn,
                  simulationPhase === 'intro' && styles.navigationStepBtnDisabled,
                ]}
              >
                <Text style={styles.navigationStepBtnText}>Siguiente</Text>
                <Ionicons color="#FFFFFF" name="chevron-forward" size={16} />
              </Pressable>
            </View>
          </View>
        )}

        {/* 6. ARRIVAL STATE */}
        {state === 'nav_arrival' && (
          <View style={styles.contentCenter}>
            <View style={[styles.stepHeader, styles.headerWalking]}>
              <Ionicons color="#FFFFFF" name="flag" size={24} />
              <Text style={[styles.stepHeaderTitle, { fontSize: 16 }]}>Llegada</Text>
            </View>

            <View style={[styles.directiveCircle, styles.circleGreen, { marginVertical: 32 }]}>
              <Ionicons color="#FFFFFF" name="checkmark-circle-outline" size={58} />
            </View>

            <Text style={styles.navDirectiveText}>Has llegado</Text>
            <Text style={styles.navDirectiveSub}>Tu destino está frente a ti</Text>

            <Pressable
              accessibilityLabel="Volver a la indicación anterior"
              onPress={handleReturnFromArrival}
              style={[styles.navigationStepBtn, styles.arrivalPreviousBtn]}
            >
              <Ionicons color="#FFFFFF" name="chevron-back" size={18} />
              <Text style={styles.navigationStepBtnText}>Volver a la indicación anterior</Text>
            </Pressable>

            <View style={[styles.navActionsRow, { width: '100%' }]}>
              <Pressable
                accessibilityLabel="Buscar entrada accesible"
                onPress={() => speak('Buscando entrada accesible para personas con discapacidad.')}
                style={styles.navActionOutlineBtn}
              >
                <Text style={styles.navActionOutlineText}>Buscar entrada</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Finalizar viaje"
                onPress={() => {
                  resetSimulation();
                  setHasAutoStartedSimulation(false);
                  setState('search_start');
                  setSelectedDest(null);
                  setSearchQuery('');
                  setRouteSteps([]);
                }}
                style={styles.navActionSolidBtn}
              >
                <Text style={styles.navActionSolidText}>Finalizar viaje</Text>
              </Pressable>
            </View>
          </View>
        )}

        {showRouteMap && displayedMapPosition && (
          <View style={styles.overlayModal}>
            <View style={styles.routeMapModal}>
              <View style={styles.overlayHeader}>
                <View>
                  <Text style={styles.overlayTitle}>Mapa del trayecto</Text>
                  <Text style={styles.routeMapSubtitle}>
                    {isSimulationEntry ? 'Posición simulada' : 'Ubicación GPS en tiempo real'}
                  </Text>
                </View>
                <Pressable accessibilityLabel="Cerrar mapa" onPress={() => setShowRouteMap(false)}>
                  <Ionicons color="#FFFFFF" name="close" size={24} />
                </Pressable>
              </View>
              <View
                onLayout={(event) => {
                  const { width, height } = event.nativeEvent.layout;
                  setRouteMapSize({ width, height });
                }}
                style={styles.routeMap}
              >
                {mapTiles.map((tile) => (
                  <Image
                    key={tile.key}
                    source={{ uri: tile.url }}
                    style={[
                      styles.routeMapTile,
                      { left: tile.left, top: tile.top },
                    ]}
                  />
                ))}
                {projectedRoute.slice(0, -1).map((point, index) => {
                  const nextPoint = projectedRoute[index + 1];
                  const deltaX = nextPoint.x - point.x;
                  const deltaY = nextPoint.y - point.y;
                  const length = Math.sqrt(deltaX ** 2 + deltaY ** 2);
                  const angle = Math.atan2(deltaY, deltaX);
                  return (
                    <View
                      key={`${index}-${point.x}-${point.y}`}
                      style={[
                        styles.routeMapSegment,
                        {
                          left: (point.x + nextPoint.x) / 2 - length / 2,
                          top: (point.y + nextPoint.y) / 2 - 3,
                          width: length,
                          transform: [{ rotate: `${angle}rad` }],
                        },
                      ]}
                    />
                  );
                })}
                {projectedMapPosition && (
                  <View
                    style={[
                      styles.routeMapCurrentMarker,
                      {
                        left: projectedMapPosition.x - 9,
                        top: projectedMapPosition.y - 9,
                      },
                    ]}
                  />
                )}
                {projectedRoute.length > 0 && (
                  <View
                    style={[
                      styles.routeMapDestinationMarker,
                      {
                        left: projectedRoute[projectedRoute.length - 1].x - 9,
                        top: projectedRoute[projectedRoute.length - 1].y - 9,
                      },
                    ]}
                  >
                    <Ionicons color="#FFFFFF" name="flag" size={11} />
                  </View>
                )}
                <View style={styles.routeMapLegend}>
                  <View style={styles.routeMapLegendCurrentDot} />
                  <Text style={styles.routeMapLegendText}>
                    {isSimulationEntry ? 'Posición simulada' : 'Tu ubicación'}
                  </Text>
                  <View style={styles.routeMapLegendDestinationDot} />
                  <Text style={styles.routeMapLegendText}>Destino</Text>
                </View>
                <Text style={styles.routeMapAttribution}>© OpenStreetMap © CARTO</Text>
              </View>
            </View>
          </View>
        )}

        {/* WHERE AM I OVERLAY */}
        {showWhereAmI && (
          <View style={styles.overlayModal}>
            <View style={styles.overlayContent}>
              <View style={styles.overlayHeader}>
                <Text style={styles.overlayTitle}>¿Dónde estoy?</Text>
                <Pressable onPress={() => setShowWhereAmI(false)}>
                  <Ionicons color="#FFFFFF" name="close" size={24} />
                </Pressable>
              </View>

              {/* Simulated Map Container */}
              <View style={styles.mockMapContainer}>
                <View style={styles.mapGridLineV} />
                <View style={styles.mapGridLineH} />
                <View style={styles.mapCurrentPin}>
                  <View style={styles.mapPinPulse} />
                  <View style={styles.mapPinInner} />
                </View>
                <Text style={styles.mapStreetLabel}>Calle detectada por GPS</Text>
              </View>

              <View style={styles.whereAmIAddressCard}>
                <Text style={styles.whereAmILocationTitle}>Dirección Aproximada</Text>
                <Text style={styles.whereAmIStreet}>{currentAddress.split(',')[0]}</Text>
                <Text style={styles.whereAmIReference}>{currentAddress}</Text>
              </View>

              <Pressable
                onPress={() => speak(`Estás en ${currentAddress}`)}
                style={styles.overlaySpeakBtn}
              >
                <Ionicons color="#FFFFFF" name="volume-high" size={20} />
                <Text style={styles.overlaySpeakBtnText}>Escuchar de nuevo</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* SOS OVERLAY */}
        {showSOS && (
          <View style={styles.overlayModal}>
            <View style={styles.overlayContent}>
              <View style={styles.overlayHeader}>
                <Text style={[styles.overlayTitle, { color: '#FF4E72' }]}>Ayuda y SOS</Text>
                <Pressable onPress={() => setShowSOS(false)}>
                  <Ionicons color="#FFFFFF" name="close" size={24} />
                </Pressable>
              </View>

              <View style={styles.sosCircleContainer}>
                <View style={styles.sosOuterRing}>
                  <Text style={styles.sosText}>SOS</Text>
                </View>
              </View>

              <Text style={styles.sosDescription}>¿Cómo puedo ayudarte?</Text>

              <View style={styles.sosButtonsWrapper}>
                <Pressable
                  onPress={() => speak('Llamando a tu contacto de emergencia guardado.')}
                  style={styles.sosActionButton}
                >
                  <Ionicons color="#FF4E72" name="call" size={20} />
                  <Text style={styles.sosActionText}>Llamar a contacto</Text>
                </Pressable>
                <Pressable
                  onPress={() => speak('Compartiendo tu ubicación en tiempo real con tu red.')}
                  style={styles.sosActionButton}
                >
                  <Ionicons color="#208AEF" name="share-social" size={20} />
                  <Text style={styles.sosActionText}>Compartir ubicación</Text>
                </Pressable>
                <Pressable
                  onPress={() => speak('Contactando al centro de asistencia remota.')}
                  style={styles.sosActionButton}
                >
                  <Ionicons color="#B18CFF" name="headset" size={20} />
                  <Text style={styles.sosActionText}>Asistencia remota</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setShowSOS(false);
                    router.replace('/home');
                  }}
                  style={styles.sosActionButton}
                >
                  <Ionicons color="#D9DEEA" name="home" size={20} />
                  <Text style={styles.sosActionText}>Volver al inicio</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setShowSOS(false);
                    resetSimulation();
                    setHasAutoStartedSimulation(false);
                    setState('search_start');
                    setSelectedDest(null);
                    setSearchQuery('');
                  }}
                  style={[styles.sosActionButton, styles.sosCancelTripButton]}
                >
                  <Ionicons color="#FF4E72" name="close-circle" size={20} />
                  <Text style={[styles.sosActionText, { color: '#FF4E72' }]}>Cancelar viaje</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* QUICK MENU */}
        <Modal
          animationType="fade"
          hardwareAccelerated
          onRequestClose={closeQuickMenu}
          onShow={() => {
            setTimeout(() => focusAccessibilityElement(quickMenuFirstOptionRef.current), 150);
          }}
          statusBarTranslucent
          transparent
          visible={showQuickMenu}
        >
          <View
            accessibilityViewIsModal
            aria-modal
            importantForAccessibility="yes"
            onAccessibilityEscape={closeQuickMenu}
            style={styles.overlayModal}
          >
            <View role="dialog" style={[styles.overlayContent, styles.quickMenuModal]}>
              <View style={styles.quickMenuHeader}>
                <View style={styles.quickMenuHeaderText}>
                  <Text accessibilityRole="header" style={styles.drawerTitle}>
                    Opciones del viaje
                  </Text>
                  <Text style={styles.quickMenuSubtitle}>
                    Elegí una opción de la lista
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Cerrar opciones del viaje"
                  accessibilityRole="button"
                  onPress={closeQuickMenu}
                  style={styles.quickMenuHeaderClose}
                >
                  <Ionicons color="#FFFFFF" name="close" size={22} />
                </Pressable>
              </View>

              <View role="list" style={styles.drawerButtonsList}>
                <Pressable
                  accessibilityHint="Abre una ventana con tu ubicación aproximada"
                  accessibilityLabel="Dónde estoy"
                  accessibilityRole="button"
                  onPress={() => {
                    runQuickMenuAction(handleWhereAmI);
                  }}
                  ref={quickMenuFirstOptionRef}
                  style={styles.drawerItem}
                >
                  <Ionicons color="#FFFFFF" name="navigate" size={18} />
                  <View style={styles.drawerItemContent}>
                    <Text style={styles.drawerItemText}>¿Dónde estoy?</Text>
                    <Text style={styles.drawerItemHint}>Consultar tu ubicación actual</Text>
                  </View>
                  <Ionicons color="#7F8A9B" name="chevron-forward" size={18} />
                </Pressable>
                <Pressable
                  accessibilityHint="Anuncia el tiempo estimado restante"
                  accessibilityLabel={`Cuánto falta. Aproximadamente ${Math.max(1, Math.round(remainingDuration / 60))} minutos`}
                  accessibilityRole="button"
                  onPress={() =>
                    runQuickMenuAction(() =>
                      speak(
                        `Faltan aproximadamente ${Math.max(1, Math.round(remainingDuration / 60))} minutos para completar el viaje.`,
                      ),
                    )
                  }
                  style={styles.drawerItem}
                >
                  <Ionicons color="#FFFFFF" name="time" size={18} />
                  <View style={styles.drawerItemContent}>
                    <Text style={styles.drawerItemText}>¿Cuánto falta?</Text>
                    <Text style={styles.drawerItemHint}>
                      {Math.max(1, Math.round(remainingDuration / 60))} minutos aproximadamente
                    </Text>
                  </View>
                  <Ionicons color="#7F8A9B" name="chevron-forward" size={18} />
                </Pressable>
                <Pressable
                  accessibilityHint="Anuncia la próxima indicación del recorrido"
                  accessibilityLabel={
                    nextStep
                      ? `Qué sigue. ${nextStep.instruction}`
                      : 'Qué sigue. Estás en el último tramo'
                  }
                  accessibilityRole="button"
                  onPress={() => {
                    runQuickMenuAction(() =>
                      nextStep
                        ? speak(`El siguiente paso es: ${nextStep.instruction}`)
                        : speak('Estás en el último tramo de tu viaje.'),
                    );
                  }}
                  style={styles.drawerItem}
                >
                  <Ionicons color="#FFFFFF" name="arrow-forward-circle" size={18} />
                  <View style={styles.drawerItemContent}>
                    <Text style={styles.drawerItemText}>¿Qué sigue?</Text>
                    <Text numberOfLines={2} style={styles.drawerItemHint}>
                      {nextStep?.instruction ?? 'Último tramo del viaje'}
                    </Text>
                  </View>
                  <Ionicons color="#7F8A9B" name="chevron-forward" size={18} />
                </Pressable>
                <Pressable
                  accessibilityHint="Repite por voz la indicación actual"
                  accessibilityLabel="Escuchar de nuevo la indicación actual"
                  accessibilityRole="button"
                  onPress={() => runQuickMenuAction(speakCurrentInstruction)}
                  style={styles.drawerItem}
                >
                  <Ionicons color="#FFFFFF" name="volume-high" size={18} />
                  <View style={styles.drawerItemContent}>
                    <Text style={styles.drawerItemText}>Escuchar de nuevo</Text>
                    <Text style={styles.drawerItemHint}>Repetir la indicación actual</Text>
                  </View>
                  <Ionicons color="#7F8A9B" name="chevron-forward" size={18} />
                </Pressable>
                <Pressable
                  accessibilityHint="Abre la pantalla de configuración"
                  accessibilityLabel="Ajustes de audio"
                  accessibilityRole="button"
                  onPress={() =>
                    runQuickMenuAction(() => {
                      router.push('/settings');
                    })
                  }
                  style={styles.drawerItem}
                >
                  <Ionicons color="#FFFFFF" name="options" size={18} />
                  <View style={styles.drawerItemContent}>
                    <Text style={styles.drawerItemText}>Ajustes de audio</Text>
                    <Text style={styles.drawerItemHint}>Configurar voz y simulación</Text>
                  </View>
                  <Ionicons color="#7F8A9B" name="chevron-forward" size={18} />
                </Pressable>
              </View>

              <Pressable
                accessibilityLabel="Cerrar opciones del viaje"
                accessibilityRole="button"
                onPress={closeQuickMenu}
                style={styles.drawerCloseBtn}
              >
                <Text style={styles.drawerCloseBtnText}>Cerrar</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#05070B',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#0D141D',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  flexContainer: {
    flex: 1,
    paddingBottom: 16,
  },
  contentCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '950',
    letterSpacing: 2,
  },
  mainPrompt: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 16,
  },
  travelModeSelector: {
    width: '100%',
    marginBottom: 16,
  },
  travelModeLabel: {
    color: '#AEB7C7',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 8,
  },
  travelModeRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
  },
  travelModeButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 10,
    backgroundColor: '#0C1118',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  travelModeButtonSelected: {
    borderColor: '#6A29FF',
    backgroundColor: '#6A29FF',
  },
  travelModeButtonText: {
    color: '#7F8A9B',
    fontSize: 12,
    fontWeight: '900',
  },
  travelModeButtonTextSelected: {
    color: '#FFFFFF',
  },
  micButtonContainer: {
    marginBottom: 36,
  },
  micOuterRing: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(106, 41, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(106, 41, 255, 0.3)',
  },
  micInnerBg: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#6A29FF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#6A29FF',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  subPrompt: {
    color: '#7F8A9B',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 48,
  },
  startActions: {
    width: '100%',
    gap: 12,
  },
  startActionBtn: {
    width: '100%',
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#0C1118',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  startActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  // Real text input container
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0C1118',
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 48,
    width: '100%',
    marginBottom: 24,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  // Searching simulated screen
  searchingTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 40,
  },
  pulseContainer: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  pulseCircle: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#6A29FF',
    backgroundColor: 'rgba(106, 41, 255, 0.08)',
  },
  pulseCircleLarge: {
    width: 160,
    height: 160,
    opacity: 0.3,
  },
  pulseCircleMedium: {
    width: 120,
    height: 120,
    opacity: 0.6,
  },
  pulseInnerBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(106, 41, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#6A29FF',
  },
  suggestionsBox: {
    width: '100%',
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 48,
  },
  suggestionsHeader: {
    color: '#7F8A9B',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  suggestionItem: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  cancelSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1D2633',
  },
  cancelSearchText: {
    color: '#7F8A9B',
    fontSize: 13,
    fontWeight: '900',
  },
  // Search Results screen
  sectionHeader: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '950',
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 12,
  },
  resultsList: {
    gap: 12,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#0C1118',
  },
  resultCardHighlighted: {
    borderColor: '#6A29FF',
    backgroundColor: 'rgba(106, 41, 255, 0.05)',
  },
  resultTextWrapper: {
    flex: 1,
  },
  resultName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  resultAddress: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  searchAgainBtn: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0C1118',
    borderWidth: 1,
    borderColor: '#1D2633',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  searchAgainText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  // Trip Summary Screen
  destinationSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    padding: 14,
    marginBottom: 16,
  },
  summaryDestIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(106, 41, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryDestInfo: {
    flex: 1,
  },
  summaryDestName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '950',
  },
  summaryDestAddr: {
    color: '#7F8A9B',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  summaryLabel: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '950',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  transitAlternatives: {
    gap: 8,
    marginBottom: 12,
  },
  transitAlternativesList: {
    gap: 8,
    paddingRight: 8,
  },
  transitAlternativesTitle: {
    color: '#D9DEEA',
    fontSize: 13,
    fontWeight: '900',
  },
  transitAlternativeCard: {
    width: 190,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  transitAlternativeCardSelected: {
    borderColor: '#4DAA57',
    backgroundColor: 'rgba(77, 170, 87, 0.08)',
  },
  transitAlternativeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  transitAlternativeName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  transitAlternativeTime: {
    color: '#AEB7C7',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  transitLinesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  transitLineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    backgroundColor: '#208AEF',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  transitLineBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  activeTransitDetails: {
    alignItems: 'center',
    gap: 10,
  },
  routeOptionCard: {
    borderWidth: 1,
    borderColor: '#6A29FF',
    borderRadius: 8,
    backgroundColor: 'rgba(106, 41, 255, 0.04)',
    padding: 14,
    gap: 14,
    marginBottom: 24,
  },
  googleMapsAttribution: {
    color: '#7F8A9B',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  routeErrorCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  routeErrorTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    marginTop: 12,
    textAlign: 'center',
  },
  routeErrorText: {
    color: '#7F8A9B',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 7,
    textAlign: 'center',
  },
  retryRouteButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 22,
    backgroundColor: '#6A29FF',
    marginTop: 18,
    paddingHorizontal: 22,
  },
  retryRouteButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  retryRouteSecondaryButton: {
    backgroundColor: '#1E293B',
    marginTop: 10,
  },
  routePathRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  routeSegment: {
    alignItems: 'center',
    gap: 4,
  },
  routeSegmentLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  routeSegmentSub: {
    color: '#7F8A9B',
    fontSize: 10,
    fontWeight: '800',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#1D2633',
  },
  summaryStatsRow: {
    flexDirection: 'row',
  },
  startNavButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#6A29FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    elevation: 4,
    shadowColor: '#6A29FF',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  startNavButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '950',
  },
  // Active Navigation UI
  stepHeader: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    marginBottom: 16,
  },
  headerWalking: {
    backgroundColor: '#4DAA57',
  },
  headerCrossing: {
    backgroundColor: '#D79B00',
  },
  headerWaiting: {
    backgroundColor: '#208AEF',
  },
  stepHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '950',
    textTransform: 'uppercase',
  },
  simulationStatusCard: {
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 12,
    backgroundColor: '#0C1118',
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  simulationStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  simulationStatusLabel: {
    color: '#AEB7C7',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  simulationStatusValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '950',
  },
  simulationProgressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#111823',
    overflow: 'hidden',
  },
  simulationProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#6A29FF',
  },
  simulationStatusHint: {
    color: '#7F8A9B',
    fontSize: 12,
    fontWeight: '800',
  },
  instructionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  simulationSceneCard: {
    width: '100%',
    alignItems: 'center',
    gap: 12,
  },
  infoSceneCard: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 16,
    backgroundColor: '#0C1118',
    padding: 20,
    gap: 10,
  },
  infoSceneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoSceneLabel: {
    color: '#AEB7C7',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  infoSceneTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '950',
  },
  infoSceneBody: {
    color: '#AEB7C7',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  directiveCircleContainer: {
    marginBottom: 24,
  },
  directiveCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  circleGreen: {
    backgroundColor: '#4DAA57',
    shadowColor: '#4DAA57',
  },
  circleYellow: {
    backgroundColor: '#D79B00',
    shadowColor: '#D79B00',
  },
  circleBlue: {
    backgroundColor: '#208AEF',
    shadowColor: '#208AEF',
  },
  simulationCountdownText: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '950',
  },
  navDirectiveText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '950',
    textAlign: 'center',
    marginBottom: 8,
  },
  navDirectiveSub: {
    color: '#AEB7C7',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  navFooterStats: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  statLabel: {
    color: '#7F8A9B',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '950',
  },
  navActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  navActionOutlineBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#0C1118',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navActionOutlineText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  navActionSOSBtn: {
    borderColor: 'rgba(255, 78, 114, 0.4)',
    backgroundColor: 'rgba(255, 78, 114, 0.05)',
  },
  navActionSOSText: {
    color: '#FF4E72',
  },
  navAudioReplayBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#6A29FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navActionSolidBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#4DAA57',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navActionSolidText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  quickMenuTriggerBtn: {
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#05070B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  routeMapTriggerBtn: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#208AEF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  routeMapTriggerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  quickMenuTriggerText: {
    color: '#7F8A9B',
    fontSize: 12,
    fontWeight: '900',
  },
  // Manual step controls
  navigationControlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(32, 138, 239, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(32, 138, 239, 0.3)',
    borderRadius: 8,
    padding: 10,
  },
  navigationStepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#208AEF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 15,
  },
  navigationStepBtnDisabled: {
    backgroundColor: '#1E293B',
    opacity: 0.5,
  },
  navigationStepBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  navigationStepIndicator: {
    color: '#8FC7FF',
    fontSize: 12,
    fontWeight: '900',
  },
  arrivalPreviousBtn: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    marginTop: 40,
    marginBottom: 12,
    minHeight: 48,
  },
  // Overlays / Modals
  overlayModal: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 7, 11, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 9999,
  },
  overlayContent: {
    width: '100%',
    backgroundColor: '#0C1118',
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 12,
    padding: 20,
  },
  routeMapModal: {
    width: '100%',
    height: '78%',
    backgroundColor: '#0C1118',
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 12,
    padding: 14,
    overflow: 'hidden',
  },
  routeMapSubtitle: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 3,
  },
  routeMap: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#09111B',
    borderWidth: 1,
    borderColor: '#1D2633',
    overflow: 'hidden',
  },
  routeMapTile: {
    position: 'absolute',
    width: 256,
    height: 256,
  },
  routeMapSegment: {
    position: 'absolute',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#6A29FF',
  },
  routeMapCurrentMarker: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#208AEF',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  routeMapDestinationMarker: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8D5BFF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  routeMapLegend: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(5, 7, 11, 0.85)',
    paddingHorizontal: 10,
  },
  routeMapLegendCurrentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#208AEF',
  },
  routeMapLegendDestinationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8D5BFF',
    marginLeft: 8,
  },
  routeMapLegendText: {
    color: '#D9DEEA',
    fontSize: 10,
    fontWeight: '800',
  },
  routeMapAttribution: {
    position: 'absolute',
    right: 6,
    bottom: 48,
    color: '#1D2633',
    fontSize: 9,
    fontWeight: '800',
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  overlayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  overlayTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '950',
  },
  mockMapContainer: {
    width: '100%',
    height: 160,
    backgroundColor: '#05070B',
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mapGridLineV: {
    position: 'absolute',
    width: 2,
    height: '100%',
    backgroundColor: '#111823',
  },
  mapGridLineH: {
    position: 'absolute',
    width: '100%',
    height: 2,
    backgroundColor: '#111823',
  },
  mapCurrentPin: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPinPulse: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(32, 138, 239, 0.25)',
  },
  mapPinInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#208AEF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  mapStreetLabel: {
    position: 'absolute',
    bottom: 8,
    color: '#596474',
    fontSize: 10,
    fontWeight: '800',
  },
  whereAmIAddressCard: {
    alignItems: 'center',
    marginBottom: 20,
  },
  whereAmILocationTitle: {
    color: '#7F8A9B',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  whereAmIStreet: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '950',
    marginTop: 4,
  },
  whereAmIReference: {
    color: '#AEB7C7',
    fontSize: 12,
    fontWeight: '850',
    textAlign: 'center',
    marginTop: 4,
  },
  overlaySpeakBtn: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#208AEF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  overlaySpeakBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  sosCircleContainer: {
    alignItems: 'center',
    marginVertical: 16,
  },
  sosOuterRing: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#FF4E72',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#FF4E72',
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  sosText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '950',
  },
  sosDescription: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 20,
  },
  sosButtonsWrapper: {
    gap: 12,
  },
  sosActionButton: {
    height: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#05070B',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  sosCancelTripButton: {
    borderColor: 'rgba(255, 78, 114, 0.3)',
    backgroundColor: 'rgba(255, 78, 114, 0.04)',
    marginTop: 10,
  },
  sosActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  quickMenuModal: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '92%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#293548',
  },
  quickMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  quickMenuHeaderText: {
    flex: 1,
  },
  quickMenuSubtitle: {
    color: '#7F8A9B',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
  },
  quickMenuHeaderClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
  },
  drawerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '950',
  },
  drawerButtonsList: {
    gap: 12,
    marginBottom: 20,
  },
  drawerItem: {
    minHeight: 62,
    borderRadius: 12,
    backgroundColor: '#05070B',
    borderWidth: 1,
    borderColor: '#1D2633',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  drawerItemContent: {
    flex: 1,
  },
  drawerItemText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  drawerItemHint: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
    marginTop: 3,
  },
  drawerCloseBtn: {
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '950',
  },
});
