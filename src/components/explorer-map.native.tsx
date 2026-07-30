import { useEffect, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  type Region,
} from 'react-native-maps';

import {
  ExplorerMapMarker,
  ExplorerMapProps,
} from './explorer-map.types';

const MAP_DELTA = 0.018;

function toRegion(location: ExplorerMapProps['userLocation']): Region {
  return {
    ...location,
    latitudeDelta: MAP_DELTA,
    longitudeDelta: MAP_DELTA,
  };
}

export default function ExplorerMap({
  userLocation,
  markers,
  focusLocation,
  focusKey,
  onMarkerPress,
}: ExplorerMapProps) {
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (focusLocation) {
      mapRef.current?.animateToRegion(toRegion(focusLocation), 650);
    }
  }, [focusKey, focusLocation]);

  return (
    <MapView
      initialRegion={toRegion(userLocation)}
      loadingEnabled
      loadingIndicatorColor="#8D5BFF"
      mapPadding={{ top: 8, right: 8, bottom: 8, left: 8 }}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      ref={mapRef}
      showsCompass
      showsMyLocationButton={false}
      showsUserLocation
      style={styles.map}>
      {markers.map((marker: ExplorerMapMarker) => (
        <Marker
          coordinate={marker}
          description={marker.description}
          key={marker.id}
          onPress={() => onMarkerPress?.(marker)}
          pinColor={marker.kind === 'search' ? '#8D5BFF' : '#208AEF'}
          title={marker.title}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
