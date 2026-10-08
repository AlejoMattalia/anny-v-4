import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Animated, Dimensions, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WifiLensConnectionCard } from '@/components/wifi-lens-connection-card';
import { clearAuthSession } from '@/lib/auth';

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
    accent: '#3C1642',
    background: '#E9E4EA',
    icon: 'pin',
    title: 'VIAJAR',
    route: '/travel',
  },
  {
    accent: '#3C1642',
    background: '#E9E4EA',
    icon: 'eye',
    title: 'EXPLORAR',
    route: '/explore',
  },
  {
    accent: '#3C1642',
    background: '#E9E4EA',
    icon: 'help',
    title: 'AYUDA',
    route: '/help',
  },
  {
    accent: '#3C1642',
    background: '#E9E4EA',
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
  const [drawerProgress] = useState(() => new Animated.Value(0));
  const drawerTranslateX = drawerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-drawerWidth, 0],
  });
  const scrimOpacity = drawerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

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
            <Ionicons color="#3C1642" name="menu" size={26} />
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
          {/* Panel de placa ESP32 con Activación deshabilitado; conexión de lentes WiFi como v3. */}
          <WifiLensConnectionCard />

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
                    <Text style={[styles.sectionTitle, { color: section.soon ? '#6F5873' : section.accent }]}>
                      {section.title}
                    </Text>
                    {section.soon ? <Text style={styles.soonBadge}>Próximamente</Text> : null}
                  </View>
                </View>

                <Ionicons
                  color={section.soon ? '#8D8290' : section.accent}
                  name="chevron-forward"
                  size={22}
                  style={styles.sectionChevron}
                />
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
            <Ionicons color="#3C1642" name="home" size={24} />
            <Text style={[styles.tabText, styles.tabActive]}>Inicio</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Capacitaciones"
            onPress={() => router.push('/training' as Href)}
            style={styles.tabItem}>
            <MaterialCommunityIcons color="#828595" name="school-outline" size={24} />
            <Text style={styles.tabText}>Capacitaciones</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Contactos"
            onPress={() => router.push('/contacts' as Href)}
            style={styles.tabItem}>
            <Ionicons color="#828595" name="call-outline" size={24} />
            <Text style={styles.tabText}>Contactos</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Perfil"
            onPress={() => router.push('/profile' as Href)}
            style={styles.tabItem}>
            <Ionicons color="#828595" name="person-circle-outline" size={24} />
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
                    <MaterialCommunityIcons color="#FFFFFF" name={item.icon} size={24} style={styles.drawerItemIcon} />
                    <Text style={styles.drawerItemText}>{item.label}</Text>
                  </Pressable>
                ))}

                <Pressable
                  accessibilityLabel="Cerrar sesión"
                  onPress={closeSession}
                  style={styles.drawerItem}>
                  <MaterialCommunityIcons color="#FFFFFF" name="logout" size={24} style={styles.drawerItemIcon} />
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
    backgroundColor: '#FCFCFC',
  },
  topGlow: {
    position: 'absolute',
    top: -160,
    right: -130,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(60, 22, 66, 0.05)',
  },
  bottomGlow: {
    position: 'absolute',
    bottom: -180,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(60, 22, 66, 0.04)',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 4,
  },
  header: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  menuButton: {
    position: 'absolute',
    left: 0,
    top: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#F2EDF3',
  },
  logo: {
    width: 70,
    height: 54,
    tintColor: '#3C1642',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 5,
    backgroundColor: '#4DAA57',
  },
  statusDotDisconnected: {
    backgroundColor: '#6F5873',
  },
  content: {
    flexGrow: 1,
    paddingTop: 8,
    paddingBottom: 20,
    gap: 18,
  },
  mainScroll: {
    flex: 1,
  },
  connectionPanel: {
    minHeight: 112,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E1D9E3',
    backgroundColor: '#FFFFFF',
    padding: 16,
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
    backgroundColor: '#F2EDF3',
    borderWidth: 1,
    borderColor: '#E1D9E3',
  },
  connectionText: {
    flex: 1,
    minWidth: 0,
  },
  connectionTitle: {
    color: '#3C1642',
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
    color: '#6F5873',
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
    borderColor: '#E1D9E3',
    backgroundColor: '#F8F6F8',
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
    backgroundColor: '#3C1642',
  },
  networkOptionInternetActive: {
    backgroundColor: '#3C1642',
  },
  networkText: {
    color: '#6F5873',
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
    borderColor: '#E1D9E3',
    backgroundColor: '#F8F6F8',
    paddingHorizontal: 10,
  },
  connectionDeviceLabel: {
    color: '#6F5873',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  connectionDeviceName: {
    color: '#3C1642',
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
    color: '#3C1642',
    fontSize: 13,
    fontWeight: '900',
  },
  batteryLabel: {
    color: '#3C1642',
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  sectionCard: {
    width: '47.5%',
    minHeight: 116,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DED5E0',
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 3,
  },
  sectionCardDisabled: {
    borderColor: '#252D38',
    backgroundColor: 'rgba(92, 102, 118, 0.12)',
    opacity: 0.72,
  },
  sectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  sectionText: {
    width: '100%',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    width: '100%',
    paddingRight: 22,
  },
  sectionTitle: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
  },
  sectionChevron: {
    position: 'absolute',
    right: 12,
    bottom: 11,
  },
  soonBadge: {
    color: '#6F5873',
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
    minHeight: 52,
    width: '86%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 25,
    backgroundColor: '#3C1642',
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
    backgroundColor: '#C1B5C3',
    opacity: 1,
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
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#E5DFE7',
    backgroundColor: '#FFFFFF',
    marginHorizontal: -18,
    paddingHorizontal: 12,
    paddingTop: 5,
  },
  tabItem: {
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabText: {
    color: '#828595',
    fontSize: 8,
    fontWeight: '800',
  },
  tabActive: {
    color: '#3C1642',
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
    backgroundColor: '#3C1642',
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
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  drawerItemIcon: {
    width: 42,
  },
  drawerItemText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  version: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
