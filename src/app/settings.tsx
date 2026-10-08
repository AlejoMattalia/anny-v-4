import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts/legacy';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { loadSettings, saveSettings } from '@/lib/settings-storage';
import { checkVoicePermissions, requestVoicePermissions, speak } from '@/lib/voice';
import { useCompass } from '@/hooks/use-compass';

type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const VOICE_RATE_MIN = 0.5;
const VOICE_RATE_MAX = 1.7;
const SIMULATION_SPEED_MIN = 0.2;
const SIMULATION_SPEED_MAX = 2.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSliderRatio(value: number, min: number, max: number) {
  return ((value - min) / (max - min)) * 100;
}

function describeVoiceRate(value: number) {
  if (value <= 0.7) return 'Muy lenta';
  if (value <= 0.9) return 'Lenta';
  if (value < 1.1) return 'Normal';
  if (value < 1.35) return 'Rapida';
  return 'Muy rapida';
}

function describeSimulationSpeed(value: number) {
  if (value <= 0.4) return 'Muy lenta';
  if (value <= 0.8) return 'Lenta';
  if (value < 1.3) return 'Normal';
  if (value < 1.9) return 'Rapida';
  return 'Muy rapida';
}

export default function SettingsScreen() {
  const [micPermission, setMicPermission] = useState(false);
  const [contactsPermission, setContactsPermission] = useState(false);
  const [compassActive, setCompassActive] = useState(false);
  const [voiceRate, setVoiceRate] = useState(1);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [scanInterval, setScanInterval] = useState(30);
  const [voiceTrackWidth, setVoiceTrackWidth] = useState(1);
  const [simulationTrackWidth, setSimulationTrackWidth] = useState(1);

  const heading = useCompass(compassActive);

  useEffect(() => {
    async function loadPermissions() {
      try {
        const contactsStatus = await Contacts.getPermissionsAsync();
        setContactsPermission(contactsStatus.status === 'granted');
      } catch {
        setContactsPermission(false);
      }

      try {
        const voiceStatus = await checkVoicePermissions();
        setMicPermission(voiceStatus.granted);
      } catch {
        setMicPermission(false);
      }
    }

    async function loadSavedSettings() {
      try {
        const saved = await loadSettings();
        setCompassActive(saved.compassActive);
        setScanInterval(clamp(Number(saved.scanInterval) || 30, 5, 120));
        setVoiceRate(clamp(saved.voiceRate, VOICE_RATE_MIN, VOICE_RATE_MAX));
        setSimulationSpeed(
          clamp(saved.simulationSpeed, SIMULATION_SPEED_MIN, SIMULATION_SPEED_MAX),
        );
      } catch {
        // Ignore
      }
    }

    void loadPermissions();
    void loadSavedSettings();

    // Listen for AppState changes to refresh permissions when returning from system settings
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        void loadPermissions();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  async function requestMicPermission() {
    if (micPermission) {
      await speak('Para desactivar el permiso de micrófono, tenés que hacerlo desde los ajustes del sistema.');
      await Linking.openSettings();
      return;
    }

    try {
      const permissions = await requestVoicePermissions({ showSettingsAlert: true });
      setMicPermission(permissions.granted);
    } catch {
      setMicPermission(false);
    }
  }

  async function requestContactsPermission() {
    if (contactsPermission) {
      await speak('Para desactivar el permiso de contactos, tenés que hacerlo desde los ajustes del sistema.');
      await Linking.openSettings();
      return;
    }

    const permission = await Contacts.requestPermissionsAsync();
    const granted = permission.status === 'granted';
    setContactsPermission(granted);

    if (!granted) {
      await speak('Abrí los ajustes de Anny y activá el permiso de contactos.');
      await Linking.openSettings();
    }
  }

  async function toggleCompass(value: boolean) {
    setCompassActive(value);
    await saveSettings({ compassActive: value });
    if (value) {
      void speak('Brújula activada para orientación.');
    } else {
      void speak('Brújula desactivada.');
    }
  }

  async function commitVoiceRateSetting(rate: number) {
    setVoiceRate(rate);
    await saveSettings({ voiceRate: rate });
    void speak(`Velocidad de voz ${describeVoiceRate(rate)}.`);
  }

  async function commitSimulationSpeedSetting(speed: number) {
    setSimulationSpeed(speed);
    await saveSettings({ simulationSpeed: speed });
    void speak(`Velocidad de simulacion ${describeSimulationSpeed(speed)}.`);
  }

  function openAppSettings() {
    void speak('Abriendo ajustes de la app.');
    void Linking.openSettings();
  }

  function renderPermissionRow({
    icon,
    label,
    value,
    onPress,
  }: {
    icon: MaterialIconName;
    label: string;
    value: boolean;
    onPress: () => void;
  }) {
    return (
      <Pressable accessibilityLabel={label} onPress={onPress} style={styles.settingRow}>
        <View style={styles.rowIcon}>
          <MaterialCommunityIcons color="#6A0DAD" name={icon} size={21} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{label}</Text>
        </View>
        <Switch
          accessibilityLabel={`Interruptor ${label}`}
          onValueChange={onPress}
          thumbColor="#FFFFFF"
          trackColor={{ false: '#DED5E0', true: '#3C1642' }}
          value={value}
        />
      </Pressable>
    );
  }

  function renderSliderControl({
    title,
    description,
    icon,
    value,
    min,
    max,
    onPreview,
    onCommit,
    trackWidth,
    onTrackLayout,
    accessibilityLabel,
    helper,
  }: {
    title: string;
    description: string;
    icon: MaterialIconName;
    value: number;
    min: number;
    max: number;
    onPreview: (value: number) => void;
    onCommit: (value: number) => void;
    trackWidth: number;
    onTrackLayout: (width: number) => void;
    accessibilityLabel: string;
    helper: string;
  }) {
    const ratio = getSliderRatio(value, min, max);
    const getNextValue = (locationX: number) => {
      const rawRatio = clamp(locationX / Math.max(trackWidth, 1), 0, 1);
      return clamp(min + rawRatio * (max - min), min, max);
    };

    return (
      <View style={styles.controlCard}>
        <View style={styles.controlHeader}>
          <MaterialCommunityIcons color="#6A0DAD" name={icon} size={21} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{title}</Text>
            <Text style={styles.rowDescription}>{description}</Text>
          </View>
        </View>

        <Pressable
          accessibilityLabel={accessibilityLabel}
          onPress={(event) => {
            const nextValue = getNextValue(event.nativeEvent.locationX);
            onPreview(nextValue);
            onCommit(nextValue);
          }}
          onResponderGrant={(event) => {
            onPreview(getNextValue(event.nativeEvent.locationX));
          }}
          onResponderMove={(event) => {
            onPreview(getNextValue(event.nativeEvent.locationX));
          }}
          onResponderRelease={(event) => {
            onCommit(getNextValue(event.nativeEvent.locationX));
          }}
          onStartShouldSetResponder={() => true}
          style={styles.sliderWrapper}
        >
          <View
            onLayout={(event) => onTrackLayout(event.nativeEvent.layout.width)}
            style={styles.sliderTrack}
          >
            <View style={[styles.sliderFill, { width: `${Math.max(ratio, 3)}%` }]} />
            <View style={[styles.sliderThumb, { left: `${Math.min(Math.max(ratio, 3), 97)}%` }]} />
          </View>
        </Pressable>

        <View style={styles.sliderLegend}>
          <Text style={styles.sliderEdgeText}>Muy lento</Text>
          <Text style={styles.sliderValueText}>{helper}</Text>
          <Text style={styles.sliderEdgeText}>Muy rapido</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Volver al inicio" onPress={() => router.replace('/home')} style={styles.backButton}>
            <Ionicons color="#3C1642" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Configuraciones</Text>
          </View>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="cog-outline" size={23} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Permisos</Text>
            {renderPermissionRow({
              icon: 'microphone-outline',
              label: 'Micrófono',
              value: micPermission,
              onPress: requestMicPermission,
            })}
            {renderPermissionRow({
              icon: 'contacts-outline',
              label: 'Contactos',
              value: contactsPermission,
              onPress: requestContactsPermission,
            })}
            <Pressable accessibilityLabel="Abrir ajustes de la app" onPress={openAppSettings} style={styles.outlineButton}>
              <MaterialCommunityIcons color="#6A0DAD" name="cog-outline" size={18} />
              <Text style={styles.outlineButtonText}>Abrir ajustes de la app</Text>
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Uso de orientación</Text>
            <Pressable accessibilityLabel="Brújula" onPress={() => toggleCompass(!compassActive)} style={styles.settingRow}>
              <View style={styles.rowIcon}>
                <MaterialCommunityIcons color="#6A0DAD" name="compass-outline" size={21} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Brújula</Text>
                {compassActive && heading !== null ? <Text style={styles.rowDescription}>{heading}°</Text> : null}
              </View>
              <Switch
                onValueChange={toggleCompass}
                thumbColor="#FFFFFF"
                trackColor={{ false: '#DED5E0', true: '#3C1642' }}
                value={compassActive}
              />
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Voz y simulacion</Text>
            {renderSliderControl({
              title: 'Velocidad de voz',
              description: 'Ajusta la rapidez con la que Anny te habla.',
              icon: 'account-voice',
              value: voiceRate,
              min: VOICE_RATE_MIN,
              max: VOICE_RATE_MAX,
              onPreview: setVoiceRate,
              onCommit: commitVoiceRateSetting,
              trackWidth: voiceTrackWidth,
              onTrackLayout: setVoiceTrackWidth,
              accessibilityLabel: 'Slider de velocidad de voz',
              helper: `${describeVoiceRate(voiceRate)} - ${voiceRate.toFixed(1)}x`,
            })}

            {renderSliderControl({
              title: 'Velocidad de simulacion',
              description: 'Controla cada cuanto cambian los pasos y las vistas del viaje.',
              icon: 'map-clock-outline',
              value: simulationSpeed,
              min: SIMULATION_SPEED_MIN,
              max: SIMULATION_SPEED_MAX,
              onPreview: setSimulationSpeed,
              onCommit: commitSimulationSpeedSetting,
              trackWidth: simulationTrackWidth,
              onTrackLayout: setSimulationTrackWidth,
              accessibilityLabel: 'Slider de velocidad de simulacion',
              helper: `${describeSimulationSpeed(simulationSpeed)} - ${simulationSpeed.toFixed(1)}x`,
            })}

            <View style={styles.settingRow}>
              <MaterialCommunityIcons color="#6F5873" name="camera-metering-center" size={21} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Escaneo automático</Text>
                <Text style={styles.rowDescription}>Cada {scanInterval} segundos</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Disminuir intervalo de escaneo" disabled={scanInterval <= 5} style={styles.backButton} onPress={() => {
                const next = Math.max(5, scanInterval - 5);
                setScanInterval(next);
                void saveSettings({ scanInterval: next });
              }}><Ionicons name="remove" size={24} color="#6A0DAD" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Aumentar intervalo de escaneo" disabled={scanInterval >= 120} style={styles.backButton} onPress={() => {
                const next = Math.min(120, scanInterval + 5);
                setScanInterval(next);
                void saveSettings({ scanInterval: next });
              }}><Ionicons name="add" size={24} color="#6A0DAD" /></Pressable>
            </View>
          </View>
        </ScrollView>
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
    top: -160,
    right: -130,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(124, 76, 255, 0.2)',
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
  headerText: {
    flex: 1,
  },
  title: {
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
    backgroundColor: '#6A0DAD',
  },
  content: {
    paddingBottom: 18,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#6F5873',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  settingRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#DED5E0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginBottom: 9,
  },
  rowIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: 'rgba(141, 91, 255, 0.14)',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: '#3C1642',
    fontSize: 14,
    fontWeight: '900',
  },
  rowDescription: {
    color: '#6F5873',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  outlineButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DED5E0',
    backgroundColor: '#F6F2F7',
  },
  outlineButtonText: {
    color: '#6A0DAD',
    fontSize: 12,
    fontWeight: '900',
  },
  protocolControl: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 9,
  },
  protocolButton: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: '#DED5E0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  protocolButtonActive: {
    borderColor: '#6A0DAD',
    backgroundColor: '#3C1642',
  },
  protocolText: {
    color: '#6F5873',
    fontSize: 12,
    fontWeight: '900',
  },
  protocolTextActive: {
    color: '#3C1642',
  },
  primaryButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#6A0DAD',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  disabledAction: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#DED5E0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    opacity: 0.65,
    paddingHorizontal: 12,
    marginBottom: 9,
  },
  disabledTitle: {
    color: '#5B465F',
    fontSize: 14,
    fontWeight: '900',
  },
  controlCard: {
    borderWidth: 1,
    borderColor: '#DED5E0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    padding: 14,
    marginBottom: 12,
  },
  controlHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  sliderWrapper: {
    width: '100%',
    paddingVertical: 10,
  },
  sliderTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: '#F6F2F7',
    overflow: 'visible',
    justifyContent: 'center',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: '#6A0DAD',
  },
  sliderThumb: {
    position: 'absolute',
    marginLeft: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#6A0DAD',
  },
  sliderLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  sliderEdgeText: {
    color: '#6F5873',
    fontSize: 11,
    fontWeight: '800',
  },
  sliderValueText: {
    color: '#3C1642',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
    flex: 1,
  },
});
