export interface MapCoordinate {
  latitude: number;
  longitude: number;
}

export interface ExplorerMapMarker extends MapCoordinate {
  id: string;
  title: string;
  description?: string;
  kind?: 'saved' | 'search';
}

export interface ExplorerMapProps {
  userLocation: MapCoordinate;
  markers: ExplorerMapMarker[];
  focusLocation?: MapCoordinate;
  focusKey?: number;
  onMarkerPress?: (marker: ExplorerMapMarker) => void;
}
