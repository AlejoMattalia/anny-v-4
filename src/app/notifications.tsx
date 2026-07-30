import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getNotificationPermission,
  requestNotificationPermission,
  scheduleNotificationTest,
  type NotificationPermissionResult,
} from '@/lib/notification-service';
import { loadSettings, saveSettings } from '@/lib/settings-storage';
import { speak } from '@/lib/voice';

const DISTANCE_OPTIONS = [100, 250, 400, 750, 1000] as const;

const initialPermission: NotificationPermissionResult = {
  canAskAgain: true,
  state: 'undetermined',
};

function getPermissionCopy(permission: NotificationPermissionResult) {
  switch (permission.state) {
    case 'granted':
      return {
        color: '#4DAA57',
        description: 'Anny puede mostrar alertas aunque no estés mirando la pantalla.',
        label: 'Activadas',
      };
    case 'denied':
      return {
        color: '#E46B6B',
        description: 'Las alertas están bloqueadas en los ajustes del dispositivo.',
        label: 'Bloqueadas',
      };
    case 'unavailable':
      return {
        color: '#D79B00',
        description: 'Las notificaciones del sistema no están disponibles en este dispositivo.',
        label: 'No disponibles',
      };
    default:
      return {
        color: '#D79B00',
        description: 'Activá el permiso para recibir avisos fuera de la pantalla de viaje.',
        label: 'Sin configurar',
      };
  }
}

export default function NotificationsScreen() {
  const [permission, setPermission] = useState(initialPermission);
  const [destinationAlertsEnabled, setDestinationAlertsEnabled] = useState(true);
  const [notificationDistance, setNotificationDistance] = useState(400);
  const [isLoading, setIsLoading] = useState(true);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const refreshPermission = useCallback(async () => {
    setPermission(await getNotificationPermission());
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadScreen() {
      const [savedSettings, currentPermission] = await Promise.all([
        loadSettings(),
        getNotificationPermission(),
      ]);

      if (!mounted) return;
      setDestinationAlertsEnabled(savedSettings.destinationAlertsEnabled);
      setNotificationDistance(savedSettings.notificationDistance);
      setPermission(currentPermission);
      setIsLoading(false);
    }

    void loadScreen();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshPermission();
      }
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [refreshPermission]);

  async function handlePermissionAction() {
    if (permission.state === 'granted' || permission.state === 'denied' && !permission.canAskAgain) {
      await speak('Abriendo los ajustes de notificaciones del dispositivo.');
      await Linking.openSettings();
      return;
    }

    setIsRequesting(true);
    const nextPermission = await requestNotificationPermission();
    setPermission(nextPermission);
    setIsRequesting(false);

    if (nextPermission.state === 'granted') {
      await speak('Notificaciones activadas.');
    } else if (nextPermission.state === 'denied') {
      await speak('No se activaron las notificaciones. Podés habilitarlas desde los ajustes del dispositivo.');
    }
  }

  async function toggleDestinationAlerts(value: boolean) {
    setDestinationAlertsEnabled(value);
    await saveSettings({ destinationAlertsEnabled: value });
    await speak(value ? 'Aviso anticipado de destino activado.' : 'Aviso anticipado de destino desactivado.');
  }

  async function selectDistance(distance: number) {
    setNotificationDistance(distance);
    await saveSettings({ notificationDistance: distance });
    await speak(`Anny te avisará a ${distance} metros del destino.`);
  }

  async function testNotification() {
    setIsTesting(true);

    try {
      await scheduleNotificationTest();
      await speak('La notificación de prueba llegará en dos segundos.');
    } catch {
      Alert.alert('Notificaciones', 'No pudimos enviar la prueba. Revisá el permiso del dispositivo.');
      await refreshPermission();
    } finally {
      setIsTesting(false);
    }
  }

  const permissionCopy = getPermissionCopy(permission);
  const canTest = permission.state === 'granted' && !isTesting;
  const permissionActionLabel =
    permission.state === 'granted'
      ? 'Administrar en el dispositivo'
      : permission.state === 'denied' && !permission.canAskAgain
        ? 'Abrir ajustes del dispositivo'
        : 'Activar notificaciones';

  function goBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/profile');
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Volver al perfil"
            onPress={goBack}
            style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Notificaciones</Text>
          </View>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="bell-outline" size={23} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.statusCard}>
            <View style={styles.statusHeader}>
              <View style={[styles.statusIcon, { backgroundColor: `${permissionCopy.color}24` }]}>
                <MaterialCommunityIcons
                  color={permissionCopy.color}
                  name={permission.state === 'granted' ? 'bell-check-outline' : 'bell-alert-outline'}
                  size={25}
                />
              </View>
              <View style={styles.statusText}>
                <Text style={styles.statusEyebrow}>Permiso del dispositivo</Text>
                <View style={styles.statusLabelRow}>
                  <View style={[styles.statusDot, { backgroundColor: permissionCopy.color }]} />
                  <Text style={[styles.statusLabel, { color: permissionCopy.color }]}>
                    {isLoading ? 'Comprobando...' : permissionCopy.label}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={styles.statusDescription}>{permissionCopy.description}</Text>
            {permission.state !== 'unavailable' ? (
              <Pressable
                accessibilityLabel={permissionActionLabel}
                disabled={isLoading || isRequesting}
                onPress={handlePermissionAction}
                style={({ pressed }) => [
                  styles.permissionButton,
                  pressed ? styles.pressed : null,
                  isLoading || isRequesting ? styles.disabled : null,
                ]}>
                <MaterialCommunityIcons
                  color="#FFFFFF"
                  name={permission.state === 'granted' ? 'cog-outline' : 'bell-plus-outline'}
                  size={18}
                />
                <Text style={styles.permissionButtonText}>
                  {isRequesting ? 'Solicitando permiso...' : permissionActionLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Alertas de viaje</Text>
            <Pressable
              accessibilityLabel="Aviso anticipado de destino"
              accessibilityRole="switch"
              accessibilityState={{ checked: destinationAlertsEnabled }}
              onPress={() => toggleDestinationAlerts(!destinationAlertsEnabled)}
              style={styles.settingRow}>
              <View style={styles.rowIcon}>
                <MaterialCommunityIcons color="#B18CFF" name="map-marker-alert-outline" size={22} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Aviso anticipado de destino</Text>
                <Text style={styles.rowDescription}>
                  Anny te avisa antes de llegar a tu destino o parada.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Activar aviso anticipado de destino"
                onValueChange={toggleDestinationAlerts}
                thumbColor="#FFFFFF"
                trackColor={{ false: '#263244', true: '#5A2371' }}
                value={destinationAlertsEnabled}
              />
            </Pressable>

            <View style={[styles.distanceCard, !destinationAlertsEnabled ? styles.disabled : null]}>
              <Text style={styles.distanceTitle}>¿Con cuánta anticipación?</Text>
              <Text style={styles.distanceDescription}>
                Elegí la distancia para recibir el primer aviso.
              </Text>
              <View accessibilityRole="radiogroup" style={styles.distanceOptions}>
                {DISTANCE_OPTIONS.map((distance) => {
                  const isSelected = notificationDistance === distance;
                  return (
                    <Pressable
                      accessibilityLabel={`${distance} metros`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: isSelected, disabled: !destinationAlertsEnabled }}
                      disabled={!destinationAlertsEnabled}
                      key={distance}
                      onPress={() => selectDistance(distance)}
                      style={({ pressed }) => [
                        styles.distanceOption,
                        isSelected ? styles.distanceOptionSelected : null,
                        pressed ? styles.pressed : null,
                      ]}>
                      <Text style={[styles.distanceValue, isSelected ? styles.distanceValueSelected : null]}>
                        {distance}
                      </Text>
                      <Text style={[styles.distanceUnit, isSelected ? styles.distanceValueSelected : null]}>
                        m
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.selectionSummary}>
                <MaterialCommunityIcons color="#B18CFF" name="volume-high" size={17} />
                <Text style={styles.selectionSummaryText}>
                  Aviso seleccionado: {notificationDistance} metros antes
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Comprobación</Text>
            <Pressable
              accessibilityLabel="Enviar notificación de prueba"
              accessibilityState={{ disabled: !canTest }}
              disabled={!canTest}
              onPress={testNotification}
              style={({ pressed }) => [
                styles.testButton,
                !canTest ? styles.testButtonDisabled : null,
                pressed ? styles.pressed : null,
              ]}>
              <MaterialCommunityIcons color={canTest ? '#B18CFF' : '#596474'} name="bell-ring-outline" size={20} />
              <View style={styles.rowText}>
                <Text style={[styles.testTitle, !canTest ? styles.testTitleDisabled : null]}>
                  {isTesting ? 'Preparando prueba...' : 'Enviar notificación de prueba'}
                </Text>
                <Text style={styles.rowDescription}>Llegará en aproximadamente 2 segundos.</Text>
              </View>
              <Ionicons color={canTest ? '#8D5BFF' : '#596474'} name="chevron-forward" size={20} />
            </Pressable>
          </View>

          <View style={styles.infoCard}>
            <MaterialCommunityIcons color="#208AEF" name="information-outline" size={21} />
            <Text style={styles.infoText}>
              La guía por voz dentro de un viaje sigue funcionando aunque bloquees las notificaciones del sistema.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#05070B',
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
    borderColor: '#1D2633',
    backgroundColor: '#0D141D',
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '900',
  },
  headerBadge: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#8D5BFF',
  },
  content: {
    paddingBottom: 24,
  },
  statusCard: {
    borderWidth: 1,
    borderColor: '#252E3B',
    borderRadius: 12,
    backgroundColor: 'rgba(12, 17, 24, 0.96)',
    padding: 14,
    marginBottom: 18,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  statusIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
  },
  statusText: {
    flex: 1,
  },
  statusEyebrow: {
    color: '#AEB7C7',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 5,
  },
  statusLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '900',
  },
  statusDescription: {
    color: '#AEB7C7',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 12,
  },
  permissionButton: {
    minHeight: 43,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 8,
    backgroundColor: '#8D5BFF',
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  settingRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginBottom: 9,
  },
  rowIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(141, 91, 255, 0.14)',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  rowDescription: {
    color: '#7F8A9B',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    marginTop: 3,
  },
  distanceCard: {
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    padding: 14,
  },
  distanceTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  distanceDescription: {
    color: '#7F8A9B',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 3,
  },
  distanceOptions: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 13,
  },
  distanceOption: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A3342',
    borderRadius: 8,
    backgroundColor: '#101721',
  },
  distanceOptionSelected: {
    borderColor: '#8D5BFF',
    backgroundColor: '#5A2371',
  },
  distanceValue: {
    color: '#AEB7C7',
    fontSize: 13,
    fontWeight: '900',
  },
  distanceUnit: {
    color: '#7F8A9B',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 1,
  },
  distanceValueSelected: {
    color: '#FFFFFF',
  },
  selectionSummary: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 7,
    backgroundColor: 'rgba(141, 91, 255, 0.11)',
    paddingHorizontal: 10,
    marginTop: 12,
  },
  selectionSummaryText: {
    flex: 1,
    color: '#D8CAFF',
    fontSize: 10,
    fontWeight: '800',
  },
  testButton: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#2A3342',
    borderRadius: 8,
    backgroundColor: '#101721',
    paddingHorizontal: 12,
  },
  testButtonDisabled: {
    opacity: 0.62,
  },
  testTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  testTitleDisabled: {
    color: '#AEB7C7',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderWidth: 1,
    borderColor: 'rgba(32, 138, 239, 0.35)',
    borderRadius: 8,
    backgroundColor: 'rgba(32, 138, 239, 0.1)',
    padding: 12,
  },
  infoText: {
    flex: 1,
    color: '#B8C9DB',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.55,
  },
});
