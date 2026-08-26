import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href, useFocusEffect } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Animated, Dimensions, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearAuthSession } from '@/lib/auth';
import {
  getConnectedAnnyGlasses,
  subscribeToBluetoothChanges,
} from '@/lib/bluetooth-glasses';
import {
  getActiveGlassesNetwork,
  subscribeToActiveGlassesNetworkChanges,
  type ActiveGlassesNetwork,
} from '@/lib/glasses-networks';

type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const drawerItems = [
  { icon: 'home-outline', label: 'Home' },
  { icon: 'account-outline', label: 'Perfil', route: '/profile' },
  { icon: 'access-point', label: 'Dispositivos', route: '/bluetooth-devices' },
  { icon: 'cog-outline', label: 'Configuraciones', route: '/settings' },
  { icon: 'book-open-page-variant-outline', label: 'Tutorial', route: '/onboarding' },
  { icon: 'file-document-outline', label: 'Términos de uso', route: '/terms' },
] satisfies readonly { icon: MaterialIconName; label: string; route?: string }[];

const homeSections: {
  accent: string;
  background: string;
  icon: string;
  route?: string;
  soon?: boolean;
  title: string;
}[] = [
  {
    accent: '#208AEF',
    background: 'rgba(32, 138, 239, 0.15)',
    icon: 'pin',
    title: 'VIAJAR',
    route: '/travel',
  },
  {
    accent: '#8D5BFF',
    background: 'rgba(141, 91, 255, 0.13)',
    icon: 'eye',
    title: 'EXPLORAR',
    route: '/explore',
  },
  {
    accent: '#4DAA57',
    background: 'rgba(77, 170, 87, 0.14)',
    icon: 'help',
    title: 'AYUDA',
    route: '/help',
  },
  {
    accent: '#D79B00',
    background: 'rgba(215, 155, 0, 0.14)',
    icon: 'gear',
    title: 'CONFIGURACIÓN',
    route: '/settings',
  },
];

const drawerWidth = Math.round(Dimensions.get('window').width * 0.82);

function SectionIcon({ name }: { name: string }) {
  const iconMap: Record<string, MaterialIconName> = {
    eye: 'eye-outline',
    pin: 'map-marker-path',
    help: 'video-account',
    gear: 'cog-outline',
  };

  return <MaterialCommunityIcons color="#FFFFFF" name={iconMap[name] ?? 'circle-outline'} size={32} />;
}

export default function HomeScreen() {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [connectedGlassesName, setConnectedGlassesName] = useState('');
  const [connectedNetwork, setConnectedNetwork] = useState<ActiveGlassesNetwork | null>(null);
  const [drawerProgress] = useState(() => new Animated.Value(0));
  const drawerTranslateX = drawerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-drawerWidth, 0],
  });
  const scrimOpacity = drawerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function refreshGlassesConnection() {
        const [device, activeNetwork] = await Promise.all([
          getConnectedAnnyGlasses(),
          getActiveGlassesNetwork(),
        ]);
        if (active) {
          setConnectedGlassesName(device?.name ?? '');
          setConnectedNetwork(
            device && activeNetwork?.deviceId === device.id
              ? activeNetwork
              : null,
          );
        }
      }

      void refreshGlassesConnection();
      const startupRefreshTimers = [1_000, 3_000].map((delay) =>
        setTimeout(() => {
          void refreshGlassesConnection();
        }, delay),
      );
      const removeBluetoothListeners = subscribeToBluetoothChanges(() => {
        // ACL_CONNECTED can arrive slightly before the serial RFCOMM socket is
        // ready. The service also emits once the socket is confirmed.
        void refreshGlassesConnection();
      });
      const removeNetworkListener = subscribeToActiveGlassesNetworkChanges(() => {
        void refreshGlassesConnection();
      });

      return () => {
        active = false;
        startupRefreshTimers.forEach(clearTimeout);
        removeBluetoothListeners();
        removeNetworkListener();
      };
    }, []),
  );

  const glassesHaveInternet = Boolean(connectedGlassesName && connectedNetwork);
  const glassesStatus = glassesHaveInternet
    ? 'Conectado'
    : connectedGlassesName
      ? 'Falta WiFi o Hotspot'
      : 'Sin conexión';

  const openDrawer = useCallback(() => {
    setDrawerVisible(true);
    Animated.timing(drawerProgress, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [drawerProgress]);

  const closeDrawer = useCallback((afterClose?: () => void) => {
    Animated.timing(drawerProgress, {
      toValue: 0,
      duration: 190,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setDrawerVisible(false);
        afterClose?.();
      }
    });
  }, [drawerProgress]);

  const edgeSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (event, gesture) =>
          !drawerVisible &&
          event.nativeEvent.pageX < 28 &&
          gesture.dx > 8 &&
          Math.abs(gesture.dy) < 24,
        onPanResponderGrant: () => {
          setDrawerVisible(true);
          drawerProgress.stopAnimation();
          drawerProgress.setValue(0);
        },
        onPanResponderMove: (_event, gesture) => {
          const nextProgress = Math.max(0, Math.min(1, gesture.dx / drawerWidth));
          drawerProgress.setValue(nextProgress);
        },
        onPanResponderRelease: (_event, gesture) => {
          const shouldOpen = gesture.dx > drawerWidth * 0.35 || gesture.vx > 0.7;

          if (shouldOpen) {
            Animated.timing(drawerProgress, {
              toValue: 1,
              duration: 160,
              useNativeDriver: true,
            }).start();
          } else {
            closeDrawer();
          }
        },
        onPanResponderTerminate: () => closeDrawer(),
      }),
    [closeDrawer, drawerProgress, drawerVisible],
  );

  function closeSession() {
    closeDrawer(() => {
      void clearAuthSession().finally(() => router.replace('/'));
    });
  }

  function selectDrawerItem(route?: string) {
    closeDrawer(() => {
      if (route) {
        router.push(route as Href);
      }
    });
  }

  return (
    <View style={styles.screen} {...edgeSwipeResponder.panHandlers}>
      <View style={styles.topGlow} />
      <View style={styles.bottomGlow} />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Abrir menú"
            onPress={openDrawer}
            style={styles.menuButton}>
            <Ionicons color="#FFFFFF" name="menu" size={24} />
          </Pressable>

          <Image
            accessibilityLabel="ANNY"
            resizeMode="contain"
            source={require('@/assets/images/logo-white.png')}
            style={styles.logo}
          />

        </View>

        <ScrollView
          style={styles.mainScroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <Pressable
            accessibilityHint="Abre la administración de dispositivos Bluetooth"
            accessibilityLabel={`Anteojos. ${
              glassesHaveInternet
                ? `Conectados a internet mediante ${connectedNetwork?.type === 'hotspot' ? 'Hotspot' : 'WiFi'}, red ${connectedNetwork?.ssid}`
                : connectedGlassesName
                  ? 'Bluetooth conectado. Falta conectar los lentes a WiFi o Hotspot'
                  : 'Sin conexión Bluetooth'
            }`}
            accessibilityRole="button"
            onPress={() => router.push(connectedGlassesName ? '/glasses-network' : '/bluetooth-devices')}
            style={styles.connectionPanel}>
            <View style={styles.connectionHeader}>
              <View style={styles.connectionIconWrap}>
                <MaterialCommunityIcons color="#B18CFF" name="glasses" size={21} />
              </View>
              <View style={styles.connectionText}>
                <Text style={styles.connectionTitle}>Anteojos</Text>
                <View style={styles.connectionStatusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      glassesHaveInternet ? null : styles.statusDotDisconnected,
                    ]}
                  />
                  <Text
                    style={[
                      styles.connectionStatusText,
                      glassesHaveInternet
                        ? null
                        : styles.connectionStatusTextDisconnected,
                    ]}>
                    {glassesStatus}
                  </Text>
                </View>
              </View>
              <Ionicons color="#7F8A9B" name="chevron-forward" size={21} />
            </View>

            <View style={styles.connectionBody}>
              <View style={styles.networkSelector}>
                <View style={[styles.networkOption, connectedGlassesName ? styles.networkOptionActive : null]}>
                  <MaterialCommunityIcons color={connectedGlassesName ? '#FFFFFF' : '#7F8A9B'} name="bluetooth" size={16} />
                  <Text style={[styles.networkText, connectedGlassesName ? styles.networkTextActive : null]}>Bluetooth</Text>
                </View>
                <View style={[styles.networkOption, glassesHaveInternet ? styles.networkOptionInternetActive : null]}>
                  <MaterialCommunityIcons
                    color={glassesHaveInternet ? '#FFFFFF' : '#FFADB4'}
                    name={connectedNetwork?.type === 'hotspot' ? 'access-point' : 'wifi'}
                    size={16}
                  />
                  <Text style={[styles.networkText, glassesHaveInternet ? styles.networkTextActive : styles.networkTextMissing]}>
                    {glassesHaveInternet ? (connectedNetwork?.type === 'hotspot' ? 'Hotspot' : 'WiFi') : 'Sin internet'}
                  </Text>
                </View>
              </View>

              <View style={styles.connectionDeviceBox}>
                <Text style={styles.connectionDeviceLabel}>Dispositivo</Text>
                <Text numberOfLines={1} style={styles.connectionDeviceName}>
                  {connectedGlassesName || 'No seleccionado'}
                </Text>
              </View>
            </View>
          </Pressable>

          <View style={styles.sections}>
            {homeSections.map((section) => (
              <Pressable
                accessibilityLabel={section.soon ? `${section.title}. Próximamente` : section.title}
                accessibilityState={{ disabled: Boolean(section.soon) }}
                disabled={section.soon}
                key={section.title}
                onPress={() => {
                  if (section.route) {
                    router.push(section.route as Href);
                  }
                }}
                style={[
                  styles.sectionCard,
                  { backgroundColor: section.background },
                  section.soon ? styles.sectionCardDisabled : null,
                ]}>
                <View style={[styles.sectionIcon, { backgroundColor: section.soon ? '#3A4350' : section.accent }]}>
                  <SectionIcon name={section.icon} />
                </View>

                <View style={styles.sectionText}>
                  <View style={styles.sectionTitleRow}>
                    <Text style={[styles.sectionTitle, { color: section.soon ? '#7F8A9B' : section.accent }]}>
                      {section.title}
                    </Text>
                    {section.soon ? <Text style={styles.soonBadge}>Próximamente</Text> : null}
                  </View>
                </View>

                <Ionicons color={section.soon ? '#596474' : section.accent} name="chevron-forward" size={27} />
              </Pressable>
            ))}
          </View>

          <Pressable
            accessibilityLabel="Hablar con Anny. Próximamente"
            accessibilityState={{ disabled: true }}
            disabled
            style={[styles.voiceBar, styles.voiceBarDisabled]}>
            <MaterialCommunityIcons color="#FFFFFF" name="microphone" size={31} style={styles.voiceIcon} />
            <View style={styles.voiceTextWrap}>
              <Text style={styles.voiceTitle}>Hablar con Anny</Text>
            </View>
          </Pressable>
        </ScrollView>

        <View style={styles.bottomTabs}>
          <Pressable accessibilityLabel="Inicio" style={styles.tabItem}>
            <Ionicons color="#8D5BFF" name="home" size={20} />
            <Text style={[styles.tabText, styles.tabActive]}>Inicio</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Capacitaciones"
            onPress={() => router.push('/training' as Href)}
            style={styles.tabItem}>
            <MaterialCommunityIcons color="#7F8A9B" name="school-outline" size={20} />
            <Text style={styles.tabText}>Capacitaciones</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Contactos"
            onPress={() => router.push('/contacts' as Href)}
            style={styles.tabItem}>
            <Ionicons color="#7F8A9B" name="call-outline" size={20} />
            <Text style={styles.tabText}>Contactos</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Perfil"
            onPress={() => router.push('/profile' as Href)}
            style={styles.tabItem}>
            <Ionicons color="#7F8A9B" name="person-circle-outline" size={20} />
            <Text style={styles.tabText}>Perfil</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {drawerVisible ? (
        <View style={styles.drawerLayer}>
          <Animated.View style={[styles.drawerScrim, { opacity: scrimOpacity }]}>
            <Pressable
              accessibilityLabel="Cerrar menú"
              onPress={() => closeDrawer()}
              style={styles.drawerScrimPressable}
            />
          </Animated.View>

          <Animated.View style={[styles.drawerAnimated, { transform: [{ translateX: drawerTranslateX }] }]}>
            <SafeAreaView style={styles.drawer}>
              <View style={styles.drawerTop}>
                <Pressable
                  accessibilityLabel="Cerrar menú"
                  onPress={() => closeDrawer()}
                  style={styles.closeButton}>
                  <Ionicons color="#FFFFFF" name="close" size={34} />
                </Pressable>

                <Image
                  accessibilityLabel="ANNY"
                  resizeMode="contain"
                  source={require('@/assets/images/logo-white.png')}
                  style={styles.drawerLogo}
                />
              </View>

              <View style={styles.drawerItems}>
                {drawerItems.map((item) => (
                  <Pressable
                    accessibilityLabel={item.label}
                    key={item.label}
                    onPress={() => selectDrawerItem(item.route)}
                    style={[styles.drawerItem, item.label === 'Home' ? styles.drawerItemActive : null]}>
                    <MaterialCommunityIcons color="#8D5BFF" name={item.icon} size={24} style={styles.drawerItemIcon} />
                    <Text style={styles.drawerItemText}>{item.label}</Text>
                  </Pressable>
                ))}

                <Pressable
                  accessibilityLabel="Cerrar sesión"
                  onPress={closeSession}
                  style={styles.drawerItem}>
                  <MaterialCommunityIcons color="#8D5BFF" name="logout" size={24} style={styles.drawerItemIcon} />
                  <Text style={styles.drawerItemText}>Cerrar sesión</Text>
                </Pressable>
              </View>

              <Text style={styles.version}>Versión: 2.0-beta.7</Text>
            </SafeAreaView>
          </Animated.View>
        </View>
      ) : null}
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
  bottomGlow: {
    position: 'absolute',
    bottom: -180,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(32, 138, 239, 0.14)',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  header: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  menuButton: {
    position: 'absolute',
    left: 0,
    top: 10,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#0D141D',
    borderWidth: 1,
    borderColor: '#1D2633',
  },
  logo: {
    width: 96,
    height: 46,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 5,
    backgroundColor: '#4DAA57',
  },
  statusDotDisconnected: {
    backgroundColor: '#7F8A9B',
  },
  content: {
    flexGrow: 1,
    paddingBottom: 8,
    gap: 12,
  },
  mainScroll: {
    flex: 1,
  },
  connectionPanel: {
    minHeight: 112,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#263244',
    backgroundColor: 'rgba(12, 17, 24, 0.98)',
    padding: 12,
    gap: 11,
  },
  connectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  connectionIconWrap: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: 'rgba(141, 91, 255, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(177, 140, 255, 0.28)',
  },
  connectionText: {
    flex: 1,
    minWidth: 0,
  },
  connectionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  connectionStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  connectionStatusText: {
    color: '#4DAA57',
    fontSize: 11,
    fontWeight: '900',
  },
  connectionStatusTextDisconnected: {
    color: '#AEB7C7',
  },
  connectionBody: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  networkSelector: {
    flex: 1,
    flexDirection: 'column',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#080C12',
    padding: 4,
    gap: 4,
  },
  networkOption: {
    flex: 1,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 7,
  },
  networkOptionActive: {
    backgroundColor: '#5A2371',
  },
  networkOptionInternetActive: {
    backgroundColor: '#315C43',
  },
  networkText: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '900',
  },
  networkTextActive: {
    color: '#FFFFFF',
  },
  networkTextMissing: {
    color: '#FFADB4',
  },
  connectionDeviceBox: {
    flex: 1.4,
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#080C12',
    paddingHorizontal: 10,
  },
  connectionDeviceLabel: {
    color: '#7F8A9B',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  connectionDeviceName: {
    color: '#D9DEEA',
    fontSize: 11,
    fontWeight: '900',
    marginTop: 3,
  },
  batteryBox: {
    width: 106,
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(77, 170, 87, 0.32)',
    backgroundColor: 'rgba(77, 170, 87, 0.11)',
    paddingHorizontal: 9,
  },
  batteryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 7,
  },
  batteryLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  batteryValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  batteryLabel: {
    color: '#D9DEEA',
    fontSize: 10,
    fontWeight: '900',
  },
  batteryTrack: {
    height: 7,
    overflow: 'hidden',
    borderRadius: 4,
    backgroundColor: 'rgba(5, 7, 11, 0.72)',
  },
  batteryFill: {
    width: '85%',
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#4DAA57',
  },
  sections: {
    flex: 1,
    gap: 12,
  },
  sectionCard: {
    flex: 1,
    minHeight: 84,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1D2633',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sectionCardDisabled: {
    borderColor: '#252D38',
    backgroundColor: 'rgba(92, 102, 118, 0.12)',
    opacity: 0.72,
  },
  sectionIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  sectionText: {
    flex: 1,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  soonBadge: {
    color: '#C4CAD4',
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
    borderWidth: 1,
    borderColor: '#465162',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(127, 138, 155, 0.16)',
  },
  voiceBar: {
    minHeight: 50,
    width: '82%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 25,
    backgroundColor: '#5A2371',
    paddingHorizontal: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  voiceBarDisabled: {
    backgroundColor: '#3A4350',
    opacity: 0.72,
    shadowOpacity: 0,
    elevation: 0,
  },
  voiceIcon: {
    marginRight: 12,
  },
  voiceTextWrap: {
    flex: 1,
  },
  voiceTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  bottomTabs: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#1D2633',
    backgroundColor: 'rgba(5, 7, 11, 0.96)',
    marginHorizontal: -10,
    paddingHorizontal: 10,
    paddingTop: 5,
  },
  tabItem: {
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabText: {
    color: '#7F8A9B',
    fontSize: 8,
    fontWeight: '800',
  },
  tabActive: {
    color: '#8D5BFF',
  },
  drawerLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    zIndex: 20,
  },
  drawerScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(5, 7, 11, 0.62)',
  },
  drawerScrimPressable: {
    flex: 1,
  },
  drawerAnimated: {
    width: drawerWidth,
    height: '100%',
  },
  drawer: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0C1118',
    borderRightWidth: 1,
    borderRightColor: '#1D2633',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 24,
  },
  drawerTop: {
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    left: 0,
    top: 8,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  drawerLogo: {
    width: 112,
    height: 52,
  },
  drawerItems: {
    flex: 1,
    paddingTop: 28,
    gap: 8,
  },
  drawerItem: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  drawerItemActive: {
    backgroundColor: '#111923',
  },
  drawerItemIcon: {
    width: 42,
  },
  drawerItemText: {
    flex: 1,
    color: '#D9DEEA',
    fontSize: 17,
    fontWeight: '800',
  },
  version: {
    color: '#7F8A9B',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
