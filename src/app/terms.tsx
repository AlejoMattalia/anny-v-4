import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getTermsOfUse } from '@/lib/api';
import { speak } from '@/lib/voice';

export default function TermsScreen() {
  const [terms, setTerms] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadTerms() {
    setIsLoading(true);
    setError('');

    try {
      const nextTerms = await getTermsOfUse();
      setTerms(nextTerms || 'No hay términos de uso disponibles.');
    } catch {
      setError('No pudimos cargar los términos de uso.');
      await speak('No pudimos cargar los términos de uso.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadTerms();
    }, 0);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.backButton}>
            <Ionicons color="#3C1642" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Términos de uso</Text>
          </View>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="file-document-outline" size={23} />
          </View>
        </View>

        {isLoading ? (
          <View style={styles.statePanel}>
            <ActivityIndicator color="#6A0DAD" />
            <Text style={styles.stateText}>Cargando términos...</Text>
          </View>
        ) : error ? (
          <View style={styles.statePanel}>
            <MaterialCommunityIcons color="#6F5873" name="file-alert-outline" size={38} />
            <Text style={styles.errorTitle}>{error}</Text>
            <Pressable accessibilityLabel="Reintentar" onPress={loadTerms} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.termsPanel}>
              <Text style={styles.termsText}>{terms}</Text>
            </View>
          </ScrollView>
        )}
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
  headerBadge: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#6A0DAD',
  },
  content: {
    paddingBottom: 18,
  },
  termsPanel: {
    borderWidth: 1,
    borderColor: '#DED5E0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  termsText: {
    color: '#3C1642',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },
  statePanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  stateText: {
    color: '#5B465F',
    fontSize: 12,
    fontWeight: '700',
  },
  errorTitle: {
    color: '#3C1642',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#6A0DAD',
    paddingHorizontal: 16,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
});
