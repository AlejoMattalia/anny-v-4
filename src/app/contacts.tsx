import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts/legacy';
import * as Linking from 'expo-linking';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getFavoriteContactNumbers, saveFavoriteContactNumbers } from '@/lib/contact-favorites';
import { speak } from '@/lib/voice';

type PhoneContact = {
  id: string;
  name: string;
  phoneNumber: string;
};

type ContactRow = PhoneContact & {
  section?: string;
  type: 'contact' | 'section';
};

function normalizePhoneNumber(phoneNumber: string) {
  return phoneNumber.replace(/[^\d+]/g, '');
}

function getDisplayName(contact: Contacts.Contact) {
  return contact.name || [contact.firstName, contact.middleName, contact.lastName].filter(Boolean).join(' ') || 'Contacto sin nombre';
}

function mapContact(contact: Contacts.ExistingContact): PhoneContact | null {
  const phoneNumber = contact.phoneNumbers?.find((phone) => Boolean(phone.number))?.number;

  if (!phoneNumber) {
    return null;
  }

  return {
    id: contact.id ?? `${getDisplayName(contact)}-${phoneNumber}`,
    name: getDisplayName(contact).trim(),
    phoneNumber,
  };
}

export default function ContactsScreen() {
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [favoriteNumbers, setFavoriteNumbers] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const favoriteContacts = useMemo(
    () => contacts.filter((contact) => favoriteNumbers.includes(contact.phoneNumber)),
    [contacts, favoriteNumbers],
  );

  const rows = useMemo<ContactRow[]>(() => {
    const nextRows: ContactRow[] = [];

    if (favoriteContacts.length) {
      nextRows.push({ id: 'favorites-title', name: '', phoneNumber: '', section: 'Favoritos', type: 'section' });
      nextRows.push(...favoriteContacts.map((contact) => ({ ...contact, type: 'contact' as const })));
    }

    nextRows.push({ id: 'all-title', name: '', phoneNumber: '', section: 'Todos los contactos', type: 'section' });
    nextRows.push(...contacts.map((contact) => ({ ...contact, type: 'contact' as const })));

    return nextRows;
  }, [contacts, favoriteContacts]);

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    setPermissionDenied(false);

    try {
      const permission = await Contacts.requestPermissionsAsync();

      if (permission.status !== 'granted') {
        setPermissionDenied(true);
        setContacts([]);
        Alert.alert(
          'Permiso de contactos',
          'Anny necesita acceso a contactos para mostrar la agenda. Si no aparece el permiso, abrí los ajustes de la app y activá Contactos.',
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() },
          ],
        );
        await speak('Necesito permiso de contactos para mostrar tu agenda. Podés activarlo desde los permisos de la app.');
        return;
      }

      const [favorites, response] = await Promise.all([
        getFavoriteContactNumbers(),
        Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers],
          pageSize: 10000,
          sort: Contacts.SortTypes.FirstName,
        }),
      ]);
      const cleanContacts = response.data
        .map(mapContact)
        .filter((contact): contact is PhoneContact => Boolean(contact))
        .sort((a, b) => a.name.localeCompare(b.name));

      setFavoriteNumbers(favorites);
      setContacts(cleanContacts);
      await speak(`Contactos. Se cargaron ${cleanContacts.length} contactos con teléfono.`);
    } catch {
      Alert.alert('Contactos', 'No pudimos cargar los contactos del celular.');
      await speak('No pudimos cargar los contactos del celular.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadContacts();
    }, 0);

    return () => clearTimeout(timeout);
  }, [loadContacts]);

  async function toggleFavorite(contact: PhoneContact) {
    const nextFavorites = favoriteNumbers.includes(contact.phoneNumber)
      ? favoriteNumbers.filter((phoneNumber) => phoneNumber !== contact.phoneNumber)
      : [...favoriteNumbers, contact.phoneNumber];

    setFavoriteNumbers(nextFavorites);
    await saveFavoriteContactNumbers(nextFavorites);
    await speak(
      nextFavorites.includes(contact.phoneNumber)
        ? `${contact.name} agregado a favoritos.`
        : `${contact.name} quitado de favoritos.`,
    );
  }

  async function callContact(contact: PhoneContact) {
    const phoneNumber = normalizePhoneNumber(contact.phoneNumber);

    await speak(`Llamando a ${contact.name}`);
    await Linking.openURL(`tel:${phoneNumber}`);
  }

  async function openContactSettings() {
    await speak('Abrí los ajustes de Anny y activá el permiso de contactos.');
    await Linking.openSettings();
  }

  function renderContact({ item }: { item: ContactRow }) {
    if (item.type === 'section') {
      return <Text style={styles.sectionTitle}>{item.section}</Text>;
    }

    const isFavorite = favoriteNumbers.includes(item.phoneNumber);

    return (
      <View style={styles.contactCard}>
        <Pressable
          accessibilityLabel={`${item.name}. ${item.phoneNumber}`}
          accessibilityRole="button"
          onPress={() => speak(`${item.name}. ${item.phoneNumber}`)}
          style={styles.contactInfo}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.contactTextWrap}>
            <Text numberOfLines={1} style={styles.contactName}>
              {item.name}
            </Text>
            <Text numberOfLines={1} style={styles.contactPhone}>
              {item.phoneNumber}
            </Text>
          </View>
        </Pressable>

        <View style={styles.contactActions}>
          <Pressable
            accessibilityLabel={isFavorite ? `Quitar ${item.name} de favoritos` : `Agregar ${item.name} a favoritos`}
            onPress={() => toggleFavorite(item)}
            style={styles.iconButton}>
            <Ionicons color={isFavorite ? '#E64D6A' : '#6F5873'} name={isFavorite ? 'heart' : 'heart-outline'} size={20} />
          </Pressable>
          <Pressable accessibilityLabel={`Llamar a ${item.name}`} onPress={() => callContact(item)} style={styles.callButton}>
            <Ionicons color="#FFFFFF" name="call" size={19} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Volver al inicio" onPress={() => router.replace('/home')} style={styles.backButton}>
            <Ionicons color="#3C1642" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Contactos</Text>
          </View>
          <Pressable accessibilityLabel="Sincronizar contactos" onPress={loadContacts} style={styles.syncButton}>
            <MaterialCommunityIcons color="#FFFFFF" name="sync" size={22} />
          </Pressable>
        </View>

        <View style={styles.summaryPanel}>
          <MaterialCommunityIcons color="#6A0DAD" name="account-group-outline" size={24} />
          <View style={styles.summaryTextWrap}>
            <Text style={styles.summaryTitle}>{contacts.length} contactos</Text>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.statePanel}>
            <ActivityIndicator color="#6A0DAD" />
            <Text style={styles.stateText}>Cargando contactos...</Text>
          </View>
        ) : contacts.length ? (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={rows}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            renderItem={renderContact}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <View style={styles.statePanel}>
            <MaterialCommunityIcons color="#6F5873" name="contacts-outline" size={36} />
            <Text style={styles.emptyTitle}>{permissionDenied ? 'Permiso pendiente' : 'Sin contactos'}</Text>
            <Text style={styles.stateText}>
              {permissionDenied
                ? 'Activá el permiso de contactos para que Anny pueda leer la agenda del celular.'
                : 'No encontramos contactos con número de teléfono.'}
            </Text>
            <Pressable accessibilityLabel="Sincronizar contactos" onPress={loadContacts} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>{permissionDenied ? 'Reintentar permiso' : 'Sincronizar contactos'}</Text>
            </Pressable>
            {permissionDenied ? (
              <Pressable accessibilityLabel="Abrir ajustes de la app" onPress={openContactSettings} style={styles.settingsButton}>
                <MaterialCommunityIcons color="#6A0DAD" name="cog-outline" size={18} />
                <Text style={styles.settingsButtonText}>Abrir ajustes</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        <View style={styles.bottomTabs}>
          <Pressable accessibilityLabel="Inicio" onPress={() => router.replace('/home')} style={styles.tabItem}>
            <Ionicons color="#6F5873" name="home-outline" size={20} />
            <Text style={styles.tabText}>Inicio</Text>
          </Pressable>
          <Pressable accessibilityLabel="Capacitaciones" onPress={() => router.push('/training' as Href)} style={styles.tabItem}>
            <MaterialCommunityIcons color="#6F5873" name="school-outline" size={20} />
            <Text style={styles.tabText}>Capacitaciones</Text>
          </Pressable>
          <Pressable accessibilityLabel="Contactos" style={styles.tabItem}>
            <Ionicons color="#6A0DAD" name="call" size={20} />
            <Text style={[styles.tabText, styles.tabActive]}>Contactos</Text>
          </Pressable>
          <Pressable accessibilityLabel="Perfil" style={styles.tabItem}>
            <Ionicons color="#6F5873" name="person-circle-outline" size={20} />
            <Text style={styles.tabText}>Perfil</Text>
          </Pressable>
        </View>
      </SafeAreaView>
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
    borderColor: '#DED5E0',
    backgroundColor: '#F2EDF3',
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: '#3C1642',
    fontSize: 19,
    fontWeight: '900',
  },
  subtitle: {
    color: '#6A0DAD',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  syncButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#6A0DAD',
  },
  summaryPanel: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#DED5E0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    padding: 12,
    marginBottom: 12,
  },
  summaryTextWrap: {
    flex: 1,
  },
  summaryTitle: {
    color: '#3C1642',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 3,
  },
  summaryText: {
    color: '#5B465F',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 18,
  },
  sectionTitle: {
    color: '#6F5873',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 8,
  },
  contactCard: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DED5E0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 9,
  },
  contactInfo: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: '#F2EDF3',
    borderWidth: 1,
    borderColor: '#DED5E0',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  contactTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  contactName: {
    color: '#3C1642',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4,
  },
  contactPhone: {
    color: '#5B465F',
    fontSize: 11,
    fontWeight: '700',
  },
  contactActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginLeft: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DED5E0',
    backgroundColor: '#F6F2F7',
  },
  callButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#6A0DAD',
  },
  statePanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: {
    color: '#3C1642',
    fontSize: 16,
    fontWeight: '900',
  },
  stateText: {
    color: '#5B465F',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#6A0DAD',
    paddingHorizontal: 16,
    marginTop: 4,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  settingsButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DED5E0',
    backgroundColor: '#F6F2F7',
    paddingHorizontal: 16,
  },
  settingsButtonText: {
    color: '#6A0DAD',
    fontSize: 12,
    fontWeight: '900',
  },
  bottomTabs: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#DED5E0',
    backgroundColor: '#FFFFFF',
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
    color: '#6F5873',
    fontSize: 10,
    fontWeight: '800',
  },
  tabActive: {
    color: '#6A0DAD',
  },
});
