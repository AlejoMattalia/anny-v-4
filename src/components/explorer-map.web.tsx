import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { ExplorerMapProps } from './explorer-map.types';

export default function ExplorerMap({
  focusLocation,
  userLocation,
}: ExplorerMapProps) {
  const location = focusLocation || userLocation;
  const openMap = () => {
    void Linking.openURL(
      `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`,
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mapa disponible en Android y iPhone</Text>
      <Text style={styles.description}>
        En la versión web podés abrir esta ubicación en OpenStreetMap.
      </Text>
      <Pressable onPress={openMap} style={styles.button}>
        <Text style={styles.buttonText}>Abrir mapa</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#0C1118',
    padding: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  description: {
    color: '#AEB7C7',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  button: {
    minHeight: 46,
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#8D5BFF',
    paddingHorizontal: 22,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
});
