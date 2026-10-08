import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CurrentLocation,
  getCurrentLocation,
  reverseGeocodeLocation,
} from '@/lib/current-location';
import { speak } from '@/lib/voice';

export default function WhereAmIScreen() {
  const [location, setLocation] = useState<CurrentLocation | null>(null);
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const locationRequestId = useRef(0);

  const locate = useCallback(async (forceRefresh = false) => {
    const requestId = ++locationRequestId.current;
    setIsLoading(true);
    setError('');
    void speak('Buscando tu ubicación actual.');

    try {
      const current = await getCurrentLocation({
        allowCached: !forceRefresh,
      });
      if (requestId !== locationRequestId.current) return;
      setLocation(current);
      setAddress('Buscando dirección…');
      setIsLoading(false);

      const currentAddress = await reverseGeocodeLocation(current);
      if (requestId !== locationRequestId.current) return;
      setAddress(currentAddress);
      void speak(`Estás en ${currentAddress}`);
    } catch (locationError) {
      if (requestId !== locationRequestId.current) return;
      const message =
        locationError instanceof Error
          ? locationError.message
          : 'No se pudo obtener tu ubicación.';
      setError(message);
      void speak(message);
    } finally {
      if (requestId === locationRequestId.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void locate();
    }, 0);

    return () => {
      clearTimeout(timeout);
      locationRequestId.current += 1;
    };
  }, [locate]);

  const openSettings = () => {
    void Linking.openSettings();
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Volver a Explorar"
            onPress={() => router.back()}
            style={styles.backButton}>
            <Ionicons color="#3C1642" name="chevron-back" size={24} />
          </Pressable>
          <Text style={styles.title}>Dónde estoy</Text>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="crosshairs-gps" size={22} />
          </View>
        </View>

        <View style={styles.content}>
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole={error ? 'alert' : undefined}
            style={styles.locationCard}>
            <View style={styles.locationIcon}>
              <MaterialCommunityIcons
                color="#208AEF"
                name="map-marker-radius-outline"
                size={42}
              />
            </View>

            {isLoading ? (
              <>
                <ActivityIndicator color="#208AEF" size="large" />
                <Text style={styles.statusText}>Buscando ubicación…</Text>
              </>
            ) : error ? (
              <>
                <Text style={styles.errorTitle}>No pudimos ubicarte</Text>
                <Text style={styles.errorText}>{error}</Text>
              </>
            ) : (
              <>
                <Text style={styles.eyebrow}>TU UBICACIÓN ACTUAL</Text>
                <Text style={styles.address}>{address}</Text>
                {location ? (
                  <Text style={styles.coordinates}>
                    {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                  </Text>
                ) : null}
                {location?.accuracy ? (
                  <Text style={styles.accuracy}>
                    Precisión aproximada: {Math.round(location.accuracy)} metros
                  </Text>
                ) : null}
              </>
            )}
          </View>

          <Pressable
            accessibilityLabel="Actualizar mi ubicación"
            disabled={isLoading}
            onPress={() => void locate(true)}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed ? styles.buttonPressed : null,
              isLoading ? styles.buttonDisabled : null,
            ]}>
            <MaterialCommunityIcons color="#FFFFFF" name="refresh" size={21} />
            <Text style={styles.primaryButtonText}>Actualizar ubicación</Text>
          </Pressable>

          {location && !error ? (
            <Pressable
              accessibilityLabel="Ver mi ubicación en el explorador de mapa"
              onPress={() =>
                router.push({
                  pathname: '/map-explorer',
                  params: {
                    latitude: location.latitude.toString(),
                    longitude: location.longitude.toString(),
                  },
                } as unknown as Href)
              }
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed ? styles.buttonPressed : null,
              ]}>
              <MaterialCommunityIcons color="#6A0DAD" name="map-outline" size={21} />
              <Text style={styles.secondaryButtonText}>Ver en el mapa</Text>
            </Pressable>
          ) : null}

          {error ? (
            <Pressable
              accessibilityLabel="Abrir configuración de la aplicación"
              onPress={openSettings}
              style={styles.settingsButton}>
              <Ionicons color="#5B465F" name="settings-outline" size={19} />
              <Text style={styles.settingsButtonText}>Abrir configuración</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FCFCFC',
  },
  topGlow: {
    position: 'absolute',
    top: -150,
    right: -120,
    width: 310,
    height: 310,
    borderRadius: 155,
    backgroundColor: 'rgba(32, 138, 239, 0.18)',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DED5E0',
    backgroundColor: '#F2EDF3',
  },
  title: {
    flex: 1,
    color: '#3C1642',
    fontSize: 19,
    fontWeight: '900',
  },
  headerBadge: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#208AEF',
  },
  content: {
    flex: 1,
    gap: 12,
  },
  locationCard: {
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#DED5E0',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    padding: 22,
  },
  locationIcon: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 38,
    backgroundColor: 'rgba(32, 138, 239, 0.14)',
    marginBottom: 4,
  },
  statusText: {
    color: '#5B465F',
    fontSize: 14,
    fontWeight: '700',
  },
  eyebrow: {
    color: '#208AEF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  address: {
    color: '#3C1642',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 28,
    textAlign: 'center',
  },
  coordinates: {
    color: '#5B465F',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  accuracy: {
    color: '#6F5873',
    fontSize: 12,
  },
  errorTitle: {
    color: '#FF8D8D',
    fontSize: 18,
    fontWeight: '900',
  },
  errorText: {
    color: '#C8D0DC',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 10,
    backgroundColor: '#208AEF',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: '#563CA0',
    borderRadius: 10,
    backgroundColor: 'rgba(141, 91, 255, 0.12)',
  },
  secondaryButtonText: {
    color: '#D8CAFF',
    fontSize: 14,
    fontWeight: '900',
  },
  settingsButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  settingsButtonText: {
    color: '#5B465F',
    fontSize: 13,
    fontWeight: '800',
  },
  buttonPressed: {
    opacity: 0.72,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});
