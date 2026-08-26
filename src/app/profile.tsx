import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearAuthSession, type AuthUser } from '@/lib/auth';
import { changeProfilePassword, getProfileUser, updateProfileUser } from '@/lib/profile';
import { speak } from '@/lib/voice';

type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type ProfileMenuItem = {
  icon: MaterialIconName;
  label: string;
  action?: 'edit';
  route?: Href;
  soon?: boolean;
};

const accountItems: ProfileMenuItem[] = [
  { icon: 'account-outline', label: 'Información personal', action: 'edit' },
  { icon: 'bluetooth', label: 'Dispositivos', route: '/bluetooth-devices' as Href },
  { icon: 'microphone-message', label: 'Comandos', soon: true },
  { icon: 'wallet-outline', label: 'Mi billetera', soon: true },
  { icon: 'bell-outline', label: 'Notificaciones', route: '/notifications' as Href },
] satisfies ProfileMenuItem[];

const legalItems: ProfileMenuItem[] = [
  { icon: 'file-document-outline', label: 'Términos de uso', route: '/terms' as Href },
] satisfies ProfileMenuItem[];

function getUserName(user: AuthUser | null) {
  const firstName = typeof user?.name === 'string' ? user.name : '';
  const lastName = typeof user?.lastName === 'string' ? user.lastName : '';
  return [firstName, lastName].filter(Boolean).join(' ').trim() || 'Usuario Anny';
}

function getStringValue(user: AuthUser | null, key: string) {
  const value = user?.[key];
  return typeof value === 'string' ? value : '';
}

export default function ProfileScreen() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const displayName = useMemo(() => getUserName(user), [user]);
  const initials = displayName
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      const profileUser = await getProfileUser();
      setUser(profileUser);
      setName(getUserName(profileUser));
      setPhone(getStringValue(profileUser, 'phone'));
      setIsLoading(false);
    }

    void loadProfile();
  }, []);

  function openEdit() {
    setName(getUserName(user));
    setPhone(getStringValue(user, 'phone'));
    setCurrentPassword('');
    setPassword('');
    setConfirmPassword('');
    setIsEditOpen(true);
    void speak('Información personal. Podés editar nombre, teléfono o cambiar tu contraseña.');
  }

  function selectSoon(label: string) {
    void speak(`${label}. Próximamente.`);
  }

  async function saveProfile() {
    const trimmedName = name.trim();

    if (!trimmedName) {
      Alert.alert('Perfil', 'Ingresá tu nombre.');
      await speak('Ingresá tu nombre.');
      return;
    }

    if (password || confirmPassword || currentPassword) {
      if (!currentPassword) {
        Alert.alert('Perfil', 'Debe ingresar su contraseña actual.');
        await speak('Debe ingresar su contraseña actual.');
        return;
      }

      if (password.length < 8) {
        Alert.alert('Perfil', 'Las contraseñas deben contener al menos 8 caracteres.');
        await speak('Las contraseñas deben contener al menos 8 caracteres.');
        return;
      }

      if (password !== confirmPassword) {
        Alert.alert('Perfil', 'Las contraseñas no coinciden.');
        await speak('Las contraseñas no coinciden.');
        return;
      }
    }

    setIsSaving(true);

    try {
      const updatedUser = await updateProfileUser({ name: trimmedName, phone: phone.trim() });

      if (password) {
        await changeProfilePassword({ currentPassword, password, confirmPassword });
      }

      setUser((currentUser) => ({ ...currentUser, ...updatedUser, name: trimmedName, phone: phone.trim() }));
      setIsEditOpen(false);
      await speak('Perfil actualizado.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No pudimos actualizar tu perfil.';
      Alert.alert('Perfil', message);
      await speak(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function logout() {
    await clearAuthSession();
    await speak('Sesión cerrada.');
    router.replace('/');
  }

  function renderMenuItem(item: ProfileMenuItem) {
    return (
      <Pressable
        accessibilityLabel={item.soon ? `${item.label}. Próximamente` : item.label}
        accessibilityRole="button"
        key={item.label}
        onPress={() => {
          if (item.action === 'edit') {
            openEdit();
          } else if (item.route) {
            router.push(item.route);
          } else {
            selectSoon(item.label);
          }
        }}
        style={({ pressed }) => [styles.menuItem, item.soon ? styles.menuItemDisabled : null, pressed ? styles.pressed : null]}>
        <View style={[styles.menuIcon, item.soon ? styles.menuIconDisabled : null]}>
          <MaterialCommunityIcons color={item.soon ? '#7F8A9B' : '#B18CFF'} name={item.icon} size={22} />
        </View>
        <View style={styles.menuTextWrap}>
          <Text style={[styles.menuLabel, item.soon ? styles.menuLabelDisabled : null]}>{item.label}</Text>
        </View>
        <Ionicons color={item.soon ? '#596474' : '#8D5BFF'} name="chevron-forward" size={20} />
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Volver al inicio" onPress={() => router.replace('/home')} style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Perfil</Text>
          </View>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="account-outline" size={23} />
          </View>
        </View>

        {isLoading ? (
          <View style={styles.statePanel}>
            <ActivityIndicator color="#8D5BFF" />
            <Text style={styles.stateText}>Cargando perfil...</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.profilePanel}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <View style={styles.profileText}>
                <Text style={styles.profileName}>{displayName}</Text>
                <Text style={styles.profileEmail}>{getStringValue(user, 'email') || 'Sin correo registrado'}</Text>
                {getStringValue(user, 'code') ? <Text style={styles.profileCode}>Código: {getStringValue(user, 'code')}</Text> : null}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Configuración de la cuenta</Text>
              {accountItems.map(renderMenuItem)}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Legal</Text>
              {legalItems.map(renderMenuItem)}
            </View>

            <Pressable accessibilityLabel="Cerrar sesión" onPress={logout} style={styles.logoutButton}>
              <MaterialCommunityIcons color="#FFFFFF" name="logout" size={19} />
              <Text style={styles.logoutText}>Cerrar sesión</Text>
            </Pressable>
          </ScrollView>
        )}

        <View style={styles.bottomTabs}>
          <Pressable accessibilityLabel="Inicio" onPress={() => router.replace('/home')} style={styles.tabItem}>
            <Ionicons color="#7F8A9B" name="home-outline" size={20} />
            <Text style={styles.tabText}>Inicio</Text>
          </Pressable>
          <Pressable accessibilityLabel="Capacitaciones" onPress={() => router.push('/training' as Href)} style={styles.tabItem}>
            <MaterialCommunityIcons color="#7F8A9B" name="school-outline" size={20} />
            <Text style={styles.tabText}>Capacitaciones</Text>
          </Pressable>
          <Pressable accessibilityLabel="Contactos" onPress={() => router.push('/contacts' as Href)} style={styles.tabItem}>
            <Ionicons color="#7F8A9B" name="call-outline" size={20} />
            <Text style={styles.tabText}>Contactos</Text>
          </Pressable>
          <Pressable accessibilityLabel="Perfil" style={styles.tabItem}>
            <Ionicons color="#8D5BFF" name="person-circle" size={20} />
            <Text style={[styles.tabText, styles.tabActive]}>Perfil</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <Modal animationType="fade" transparent visible={isEditOpen} onRequestClose={() => setIsEditOpen(false)}>
        <View style={styles.modalLayer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Información personal</Text>

            <TextInput
              accessibilityLabel="Nombre o alias"
              onChangeText={setName}
              placeholder="Nombre o alias"
              placeholderTextColor="#7F8A9B"
              style={styles.input}
              value={name}
            />
            <TextInput
              accessibilityLabel="Número de teléfono"
              keyboardType="phone-pad"
              onChangeText={setPhone}
              placeholder="Número de teléfono"
              placeholderTextColor="#7F8A9B"
              style={styles.input}
              value={phone}
            />
            <TextInput
              accessibilityLabel="Contraseña actual"
              onChangeText={setCurrentPassword}
              placeholder="Contraseña actual"
              placeholderTextColor="#7F8A9B"
              secureTextEntry
              style={styles.input}
              value={currentPassword}
            />
            <TextInput
              accessibilityLabel="Nueva contraseña"
              onChangeText={setPassword}
              placeholder="Nueva contraseña"
              placeholderTextColor="#7F8A9B"
              secureTextEntry
              style={styles.input}
              value={password}
            />
            <TextInput
              accessibilityLabel="Confirmar contraseña nueva"
              onChangeText={setConfirmPassword}
              placeholder="Confirmar contraseña nueva"
              placeholderTextColor="#7F8A9B"
              secureTextEntry
              style={styles.input}
              value={confirmPassword}
            />

            <Pressable
              accessibilityLabel="Guardar cambios"
              disabled={isSaving}
              onPress={saveProfile}
              style={[styles.saveButton, isSaving ? styles.disabledButton : null]}>
              <Text style={styles.saveButtonText}>{isSaving ? 'Guardando...' : 'Guardar'}</Text>
            </Pressable>
            <Pressable accessibilityLabel="Cancelar cambios" onPress={() => setIsEditOpen(false)} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  subtitle: {
    color: '#B18CFF',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
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
    paddingBottom: 18,
  },
  profilePanel: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: 'rgba(12, 17, 24, 0.94)',
    padding: 12,
    marginBottom: 16,
  },
  avatar: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 27,
    backgroundColor: '#8D5BFF',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 4,
  },
  profileEmail: {
    color: '#AEB7C7',
    fontSize: 12,
    fontWeight: '700',
  },
  profileCode: {
    color: '#B18CFF',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 5,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  menuItem: {
    minHeight: 60,
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
  menuItemDisabled: {
    opacity: 0.68,
  },
  pressed: {
    opacity: 0.82,
  },
  menuIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: 'rgba(141, 91, 255, 0.14)',
  },
  menuIconDisabled: {
    backgroundColor: '#151D28',
  },
  menuTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  menuLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 3,
  },
  menuLabelDisabled: {
    color: '#AEB7C7',
  },
  menuMeta: {
    color: '#7F8A9B',
    fontSize: 10,
    fontWeight: '800',
  },
  logoutButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    backgroundColor: '#8D5BFF',
    marginTop: 2,
  },
  logoutText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  statePanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  stateText: {
    color: '#AEB7C7',
    fontSize: 12,
    fontWeight: '700',
  },
  bottomTabs: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#1D2633',
    backgroundColor: 'rgba(5, 7, 11, 0.96)',
    marginHorizontal: -14,
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
    fontSize: 10,
    fontWeight: '800',
  },
  tabActive: {
    color: '#8D5BFF',
  },
  modalLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 18,
  },
  modalContent: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    padding: 14,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 4,
  },
  modalSubtitle: {
    color: '#AEB7C7',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#101721',
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 12,
    marginBottom: 9,
  },
  saveButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#8D5BFF',
    marginTop: 3,
  },
  disabledButton: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  cancelButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A3342',
    backgroundColor: '#101721',
    marginTop: 8,
  },
  cancelButtonText: {
    color: '#B18CFF',
    fontSize: 13,
    fontWeight: '900',
  },
});
