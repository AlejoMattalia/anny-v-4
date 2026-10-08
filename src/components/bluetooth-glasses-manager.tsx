import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  ensureRememberedGlassesConnected,
  getBluetoothErrorMessage,
  hasRememberedGlasses,
  subscribeToBluetoothChanges,
} from '@/lib/bluetooth-glasses';
import { connectGlassesToNearbySavedNetwork } from '@/lib/automatic-glasses-network';
import { speak } from '@/lib/voice';

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];
const CONNECTING_NOTICE_TIMEOUT_MS = 8_000;
type ConnectionNotice = 'hidden' | 'connecting' | 'connecting-wifi' | 'connected';

export function BluetoothGlassesManager() {
  const [connectionNotice, setConnectionNotice] =
    useState<ConnectionNotice>('hidden');
  const appIsActive = useRef(AppState.currentState === 'active');
  const connected = useRef(false);
  const [connectedNetworkName, setConnectedNetworkName] = useState('');
  const retryIndex = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    let mounted = true;

    function clearRetry() {
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    }

    function clearNoticeTimer() {
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
        noticeTimer.current = null;
      }
    }

    function showConnectedNotice(networkName = '') {
      clearNoticeTimer();
      setConnectedNetworkName(networkName);
      setConnectionNotice('connected');
      noticeTimer.current = setTimeout(() => {
        noticeTimer.current = null;
        if (mounted) {
          setConnectionNotice('hidden');
        }
      }, 2_000);
    }

    function showConnectingNotice() {
      clearNoticeTimer();
      setConnectionNotice('connecting');
      noticeTimer.current = setTimeout(() => {
        noticeTimer.current = null;
        if (mounted) {
          setConnectionNotice('hidden');
        }
      }, CONNECTING_NOTICE_TIMEOUT_MS);
    }

    function scheduleRetry() {
      if (!mounted || !appIsActive.current || retryTimer.current) {
        return;
      }

      const delay =
        RETRY_DELAYS_MS[
          Math.min(retryIndex.current, RETRY_DELAYS_MS.length - 1)
        ];
      retryIndex.current += 1;
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        void reconnect();
      }, delay);
    }

    async function reconnect() {
      if (!mounted || !appIsActive.current) {
        return;
      }

      try {
        const remembered = await hasRememberedGlasses();
        if (!mounted) return;
        if (!remembered) {
          setConnectionNotice('hidden');
          return;
        }

        showConnectingNotice();
        const glasses = await ensureRememberedGlassesConnected();
        if (!mounted) return;

        if (glasses) {
          clearNoticeTimer();
          clearRetry();
          retryIndex.current = 0;
          const isNewBluetoothConnection = !connected.current;
          connected.current = true;
          setConnectionNotice('connecting-wifi');

          let networkName = '';
          try {
            const networkResult = await connectGlassesToNearbySavedNetwork(glasses);
            if (!mounted) return;
            if (networkResult.status === 'connected') {
              networkName = networkResult.network.ssid;
            }
          } catch (networkError) {
            console.warn('[AnnyWiFi] No se pudo completar la reconexión automática', networkError);
          }

          if (!mounted) return;
          showConnectedNotice(networkName);
          if (isNewBluetoothConnection) {
            console.info(
              `[AnnyBluetooth] Conectado automáticamente a ${glasses.name} (${glasses.id})`,
            );
            await speak(
              networkName
                ? `Lentes conectados por Bluetooth y a la red ${networkName}.`
                : 'Bluetooth de los lentes conectado. No encontré una red guardada cercana.',
            );
          }
          return;
        }

        connected.current = false;
        clearNoticeTimer();
        setConnectionNotice('hidden');
        scheduleRetry();
      } catch (error) {
        if (!mounted) return;
        connected.current = false;
        clearNoticeTimer();
        setConnectionNotice('hidden');
        console.warn(
          `[AnnyBluetooth] Reconexión pendiente: ${getBluetoothErrorMessage(error)}`,
        );
        scheduleRetry();
      }
    }

    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        appIsActive.current = nextState === 'active';
        if (appIsActive.current) {
          clearRetry();
          retryIndex.current = 0;
          void reconnect();
        } else {
          clearRetry();
          clearNoticeTimer();
          setConnectionNotice('hidden');
        }
      },
    );
    const removeBluetoothListeners = subscribeToBluetoothChanges(() => {
      clearRetry();
      setTimeout(() => {
        if (mounted) {
          void reconnect();
        }
      }, 500);
    });

    void reconnect();

    return () => {
      mounted = false;
      clearRetry();
      clearNoticeTimer();
      appStateSubscription.remove();
      removeBluetoothListeners();
    };
  }, []);

  if (connectionNotice === 'hidden') {
    return null;
  }

  const connectionCompleted = connectionNotice === 'connected';

  return (
    <View pointerEvents="none" style={styles.noticeLayer}>
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[
          styles.notice,
          connectionCompleted ? styles.noticeConnected : null,
        ]}
      >
        <View
          style={[
            styles.iconContainer,
            connectionCompleted ? styles.iconContainerConnected : null,
          ]}
        >
          {connectionCompleted ? (
            <MaterialCommunityIcons color="#FFFFFF" name="check" size={23} />
          ) : (
            <ActivityIndicator color="#6A0DAD" size="small" />
          )}
        </View>
        <View style={styles.noticeText}>
          <Text style={styles.noticeTitle}>
            {connectionCompleted
              ? connectedNetworkName
                ? 'Lentes conectados'
                : 'Bluetooth conectado'
              : connectionNotice === 'connecting-wifi'
                ? 'Buscando una red guardada…'
                : 'Conectando lentes Anny…'}
          </Text>
          <Text style={styles.noticeSubtitle}>
            {connectionCompleted
              ? connectedNetworkName
                ? `Conectados a ${connectedNetworkName}.`
                : 'No se encontró una red guardada cercana.'
              : connectionNotice === 'connecting-wifi'
                ? 'Revisando las redes WiFi cercanas.'
                : 'Mantenelos encendidos y cerca.'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  noticeLayer: {
    alignItems: 'center',
    left: 20,
    position: 'absolute',
    right: 20,
    top: 58,
    zIndex: 1000,
  },
  notice: {
    alignItems: 'center',
    backgroundColor: '#F2EDF3',
    borderColor: 'rgba(177, 140, 255, 0.55)',
    borderRadius: 18,
    borderWidth: 1,
    elevation: 12,
    flexDirection: 'row',
    maxWidth: 420,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.34,
    shadowRadius: 16,
    width: '100%',
  },
  noticeConnected: {
    borderColor: 'rgba(70, 203, 123, 0.65)',
  },
  iconContainer: {
    alignItems: 'center',
    backgroundColor: 'rgba(177, 140, 255, 0.14)',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    marginRight: 12,
    width: 44,
  },
  iconContainerConnected: {
    backgroundColor: '#35A864',
  },
  noticeText: {
    flex: 1,
  },
  noticeTitle: {
    color: '#3C1642',
    fontSize: 15,
    fontWeight: '700',
  },
  noticeSubtitle: {
    color: '#A9B1C1',
    fontSize: 13,
    marginTop: 3,
  },
});
