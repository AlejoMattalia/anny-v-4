import React, {useState} from 'react';
import {Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {MaterialCommunityIcons as Icon} from '@expo/vector-icons';
import {STREAMING_MODES} from '../services/StreamingModes';
import type {StreamingMode} from '../services/StreamingModes';

const ICONS: Record<StreamingMode, React.ComponentProps<typeof Icon>['name']> = {
  viaje: 'compass-outline', facultad: 'school-outline', supermercado: 'cart-outline',
  deporte: 'walk', seguro: 'shield-check-outline',
};

export default function StreamingModePicker({mode, onSelect, onVisibilityChange}: {
  mode: StreamingMode; onSelect: (mode: StreamingMode) => void; onVisibilityChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const changeOpen = (visible: boolean) => {setOpen(visible); onVisibilityChange?.(visible);};
  const selected = STREAMING_MODES[mode];
  return (
    <>
      <TouchableOpacity style={styles.current} activeOpacity={0.8} onPress={() => changeOpen(true)}
        accessibilityRole="button" accessibilityLabel={`Modo ${selected.label}. Cambiar modo`}
        accessibilityHint="Abre los cinco modos de asistencia">
        <View style={styles.icon}><Icon name={ICONS[mode]} size={28} color="#74F5D4" /></View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>MODO ACTIVO</Text>
          <Text style={styles.currentTitle}>{selected.label}</Text>
          <Text style={styles.hint}>{selected.hint}</Text>
        </View>
        <Icon name="chevron-down" size={26} color="#74F5D4" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => changeOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={() => changeOpen(false)}>
            <View style={styles.heading}>
              <Text style={styles.title} accessibilityRole="header">Elegí tu modo</Text>
              <TouchableOpacity style={styles.close} onPress={() => changeOpen(false)}
                accessibilityRole="button" accessibilityLabel="Cerrar selección de modo">
                <Icon name="close" size={26} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <Text style={styles.intro}>Tocá una opción. También podés tocar Preguntar y decir el comando.</Text>
            <ScrollView contentContainerStyle={styles.options}>
              {(Object.keys(STREAMING_MODES) as StreamingMode[]).map(value => {
                const item = STREAMING_MODES[value];
                const active = value === mode;
                return (
                  <TouchableOpacity key={value} activeOpacity={0.8}
                    style={[styles.option, active && styles.selected]}
                    accessibilityRole="radio" accessibilityState={{checked: active}}
                    accessibilityLabel={`Modo ${item.label}`} accessibilityHint={item.hint}
                    onPress={() => {changeOpen(false); onSelect(value);}}>
                    <View style={styles.icon}><Icon name={ICONS[value]} size={28} color="#74F5D4" /></View>
                    <View style={styles.copy}>
                      <Text style={styles.optionTitle}>{item.label}</Text>
                      <Text style={styles.hint}>{item.hint}</Text>
                      <Text style={styles.command}>Decí «modo {item.label.toLowerCase()}»</Text>
                    </View>
                    <Icon name={active ? 'check-circle' : 'circle-outline'} size={24} color={active ? '#74F5D4' : '#A6B8C5'} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  current: {width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 88,
    padding: 16, marginBottom: 12, backgroundColor: '#122B31', borderRadius: 20, borderWidth: 1, borderColor: '#438D80'},
  icon: {width: 48, height: 48, borderRadius: 15, backgroundColor: '#1D3E43', alignItems: 'center', justifyContent: 'center'},
  copy: {flex: 1},
  eyebrow: {fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: '#74F5D4'},
  currentTitle: {fontSize: 21, fontWeight: '700', color: '#FFFFFF', marginVertical: 2},
  hint: {fontSize: 14, color: '#CBD8E1', lineHeight: 20},
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end'},
  sheet: {maxHeight: '88%', paddingTop: 16, paddingHorizontal: 20, paddingBottom: 28,
    backgroundColor: '#0D1B25', borderTopLeftRadius: 28, borderTopRightRadius: 28},
  heading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  title: {flex: 1, fontSize: 26, fontWeight: '700', color: '#FFFFFF'},
  close: {minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center'},
  intro: {fontSize: 15, color: '#CBD8E1', lineHeight: 22, marginTop: 4, marginBottom: 16},
  options: {gap: 10, paddingBottom: 8},
  option: {flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 100, padding: 14,
    borderRadius: 18, backgroundColor: '#182A37', borderWidth: 2, borderColor: '#344B5C'},
  selected: {backgroundColor: '#163D39', borderColor: '#74F5D4'},
  optionTitle: {fontSize: 19, fontWeight: '700', color: '#FFFFFF', marginBottom: 3},
  command: {fontSize: 13, color: '#74F5D4', marginTop: 6},
});
