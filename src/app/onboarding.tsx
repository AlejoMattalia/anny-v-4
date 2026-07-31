import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { appApiUrl, getOnboardingSteps, type OnboardingStep } from '@/lib/api';
import { markOnboardingSeen } from '@/lib/onboarding-storage';
import { speak } from '@/lib/voice';

export default function OnboardingScreen() {
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadSteps() {
      try {
        const nextSteps = await getOnboardingSteps();

        if (mounted) {
          setSteps(nextSteps);
          setError(nextSteps.length > 0 ? '' : 'No hay pasos ANNY publicados.');
        }
      } catch {
        if (mounted) {
          setError('No pudimos cargar los pasos ANNY.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadSteps();

    return () => {
      mounted = false;
    };
  }, []);

  const activeStep = steps[activeIndex];
  const content = activeStep?.content?.es ?? '';
  const canGoBack = activeIndex > 0;
  const canGoNext = activeIndex < steps.length - 1;

  useEffect(() => {
    if (loading || error || steps.length === 0) {
      return;
    }

    void speak(`Paso ${activeIndex + 1} de ${steps.length}. Tocá escuchar descripción para oír el contenido.`);
  }, [activeIndex, error, loading, steps.length]);

  async function finishOnboarding() {
    await markOnboardingSeen();
    router.replace('/');
  }

  async function speakCurrentStep() {
    if (!content) {
      await speak(`Paso ${activeIndex + 1} de ${steps.length}. No hay descripción disponible.`);
      return;
    }

    await speak(`Paso ${activeIndex + 1} de ${steps.length}. ${content}`);
  }

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Volver al inicio de sesión"
            onPress={finishOnboarding}
            style={styles.backButton}>
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Pasos ANNY</Text>
        </View>

        <View style={styles.content}>
          <Image
            accessibilityLabel="ANNY"
            resizeMode="contain"
            source={require('@/assets/images/logo-white.png')}
            style={styles.logo}
          />

          <View style={styles.panel}>
            {loading ? (
              <View style={styles.stateBox}>
                <ActivityIndicator color="#8D5BFF" />
                <Text style={styles.stateText}>Cargando pasos...</Text>
              </View>
            ) : error ? (
              <View style={styles.stateBox}>
                <Text style={styles.errorText}>{error}</Text>
                <Text style={styles.stateText}>
                  {appApiUrl
                    ? 'Revisá tu conexión e intentá nuevamente.'
                    : 'Configurá EXPO_PUBLIC_APP_API_URL para leerlos desde el backend.'}
                </Text>
              </View>
            ) : (
              <>
	                <View style={styles.stepBody}>
	                  <View style={styles.stepHeaderRow}>
	                    <Text style={styles.stepCounter}>
	                      Paso {activeIndex + 1} de {steps.length}
	                    </Text>
	                    <Pressable
	                      accessibilityLabel={`Escuchar descripción del paso ${activeIndex + 1} de ${steps.length}`}
	                      accessibilityRole="button"
	                      onPress={speakCurrentStep}
	                      style={({ pressed }) => [styles.listenButton, pressed ? styles.listenButtonPressed : null]}>
	                      <Text style={styles.listenButtonText}>Escuchar descripción</Text>
	                    </Pressable>
	                  </View>
	                  <ScrollView
	                    contentContainerStyle={styles.stepTextContent}
	                    showsVerticalScrollIndicator={false}>
	                    <Text style={styles.stepText}>{content}</Text>
	                  </ScrollView>
	                </View>

                <View style={styles.stepFooter}>
                  <View style={styles.dots}>
                    {steps.map((step, index) => (
                      <View
                        key={step._id ?? `${index}`}
                        style={[styles.dot, index === activeIndex ? styles.dotActive : null]}
                      />
                    ))}
                  </View>

                  <View style={styles.actions}>
                    <Pressable
                      accessibilityLabel="Paso anterior"
                      disabled={!canGoBack}
                      onPress={() => setActiveIndex((index) => Math.max(index - 1, 0))}
                      style={[styles.stepButton, !canGoBack ? styles.stepButtonDisabled : null]}>
                      <Text style={styles.stepButtonText}>Anterior</Text>
                    </Pressable>

                    {canGoNext ? (
                      <Pressable
                        accessibilityLabel="Siguiente paso"
                        onPress={() => setActiveIndex((index) => Math.min(index + 1, steps.length - 1))}
                        style={styles.primaryButton}>
                        <Text style={styles.primaryButtonText}>Siguiente</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityLabel="Ir a iniciar sesión"
                        onPress={finishOnboarding}
                        style={styles.primaryButton}>
                        <Text style={styles.primaryButtonText}>Iniciar sesión</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#05070B',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#16202C',
    backgroundColor: '#080D13',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101822',
    borderWidth: 1,
    borderColor: '#1D2633',
  },
  backIcon: {
    color: '#FFFFFF',
    fontSize: 34,
    lineHeight: 36,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    marginLeft: 12,
  },
  content: {
    flex: 1,
    padding: 18,
    paddingBottom: 18,
  },
  logo: {
    width: 130,
    height: 46,
    alignSelf: 'center',
    marginVertical: 18,
  },
  panel: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    padding: 16,
    justifyContent: 'space-between',
  },
  stateBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 8,
    backgroundColor: '#101822',
    padding: 18,
  },
  stateText: {
    color: '#AEB7C7',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorText: {
    color: '#FF8F9A',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  stepCounter: {
    color: '#B18CFF',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  stepHeaderRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  stepBody: {
    flex: 1,
    minHeight: 0,
  },
  stepTextContent: {
    paddingBottom: 14,
  },
  stepText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 26,
  },
  listenButton: {
    minHeight: 34,
    flexShrink: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A3342',
    backgroundColor: '#151D28',
    paddingHorizontal: 10,
  },
  listenButtonPressed: {
    opacity: 0.82,
  },
  listenButtonText: {
    color: '#B18CFF',
    fontSize: 12,
    fontWeight: '900',
  },
  stepFooter: {
    marginTop: 18,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 18,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#303B4C',
  },
  dotActive: {
    width: 22,
    backgroundColor: '#8D5BFF',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  stepButton: {
    flex: 1,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#101822',
  },
  stepButtonDisabled: {
    opacity: 0.42,
  },
  stepButtonText: {
    color: '#D9DEEA',
    fontSize: 15,
    fontWeight: '800',
  },
  primaryButton: {
    flex: 1,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#8D5BFF',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
});
