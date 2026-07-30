import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type TravelMode = 'walking' | 'driving' | 'transit';

interface TravelModePickerProps {
  placeName: string;
  visible: boolean;
  onClose: () => void;
  onSelect: (mode: TravelMode) => void;
}

const travelModes = [
  {
    mode: 'walking',
    label: 'A pie',
    description: 'Indicaciones para caminar',
    icon: 'walk',
    accent: '#4DAA57',
  },
  {
    mode: 'driving',
    label: 'Auto',
    description: 'Ruta para conducir',
    icon: 'car-outline',
    accent: '#208AEF',
  },
  {
    mode: 'transit',
    label: 'Transporte público',
    description: 'Colectivos y tramos a pie',
    icon: 'bus',
    accent: '#D79B00',
  },
] satisfies readonly {
  mode: TravelMode;
  label: string;
  description: string;
  icon: 'walk' | 'car-outline' | 'bus';
  accent: string;
}[];

export default function TravelModePicker({
  placeName,
  visible,
  onClose,
  onSelect,
}: TravelModePickerProps) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Cerrar opciones de viaje"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <Ionicons color="#FFFFFF" name="navigate" size={20} />
            </View>
            <View style={styles.titleText}>
              <Text style={styles.title}>¿Cómo querés ir?</Text>
              <Text numberOfLines={1} style={styles.destination}>{placeName}</Text>
            </View>
            <Pressable
              accessibilityLabel="Cerrar"
              onPress={onClose}
              style={styles.closeButton}>
              <Ionicons color="#AEB7C7" name="close" size={23} />
            </Pressable>
          </View>

          <View style={styles.options}>
            {travelModes.map((option) => (
              <Pressable
                accessibilityHint={option.description}
                accessibilityLabel={`Ir en ${option.label}`}
                accessibilityRole="button"
                key={option.mode}
                onPress={() => onSelect(option.mode)}
                style={({ pressed }) => [
                  styles.option,
                  pressed ? styles.optionPressed : null,
                ]}>
                <View
                  style={[
                    styles.optionIcon,
                    { backgroundColor: `${option.accent}22` },
                  ]}>
                  <MaterialCommunityIcons
                    color={option.accent}
                    name={option.icon}
                    size={24}
                  />
                </View>
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                </View>
                <Ionicons color={option.accent} name="chevron-forward" size={21} />
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
  },
  sheet: {
    borderTopWidth: 1,
    borderTopColor: '#293546',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: '#0A0F16',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#364252',
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginBottom: 16,
  },
  titleIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: '#8D5BFF',
  },
  titleText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  destination: {
    color: '#8D98A9',
    fontSize: 12,
  },
  closeButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: {
    gap: 9,
  },
  option: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderColor: '#1D2836',
    borderRadius: 11,
    backgroundColor: '#101720',
    paddingHorizontal: 12,
  },
  optionPressed: {
    opacity: 0.72,
  },
  optionIcon: {
    width: 43,
    height: 43,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  optionText: {
    flex: 1,
    gap: 3,
  },
  optionLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  optionDescription: {
    color: '#7F8A9B',
    fontSize: 11,
  },
});
