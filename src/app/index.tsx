import { Ionicons } from '@expo/vector-icons';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, router, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useMemo, useState } from 'react';

import { getAuthSession, loginWithEmail } from '@/lib/auth';
import { hasSeenOnboarding } from '@/lib/onboarding-storage';
import { listenOnce, normalizeSpokenEmail, normalizeSpokenPassword, speak } from '@/lib/voice';

type LoginErrors = {
  email?: string;
  password?: string;
};

const emailPattern = /^\S+@\S+\.\S+$/;
export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');

  useEffect(() => {
    let mounted = true;

    async function redirectFirstTimeUser() {
      const session = await getAuthSession();

      if (mounted && session) {
        router.replace('/home' as Href);
        return;
      }

      const seen = await hasSeenOnboarding();

      if (mounted && !seen) {
        router.replace('/onboarding' as Href);
        return;
      }

      if (mounted) {
        setTimeout(() => {
          void speak('Iniciar sesión. Ingrese su correo y contraseña. Si deseas dictarlos, tocá el botón del micrófono.');
        }, 900);
      }
    }

    redirectFirstTimeUser();

    return () => {
      mounted = false;
    };
  }, []);

  const errors = useMemo<LoginErrors>(() => {
    const nextErrors: LoginErrors = {};

    if (!email.trim()) {
      nextErrors.email = 'Ingresá tu correo electrónico.';
    } else if (!emailPattern.test(email.trim())) {
      nextErrors.email = 'El correo electrónico no es válido.';
    }

    if (!password) {
      nextErrors.password = 'Ingresá tu contraseña.';
    } else if (password.length < 8) {
      nextErrors.password = 'La contraseña debe tener al menos 8 caracteres.';
    }

    return nextErrors;
  }, [email, password]);

  const hasErrors = Object.keys(errors).length > 0;

  async function handleLogin() {
    setSubmitted(true);
    setLoginError('');

    if (hasErrors || isLoggingIn) {
      return;
    }

    setIsLoggingIn(true);

    try {
      await loginWithEmail(email, password);
      router.replace('/home' as Href);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'No pudimos iniciar sesión.');
    } finally {
      setIsLoggingIn(false);
    }
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    setLoginError('');
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    setLoginError('');
  }

  async function handleVoiceLogin() {
    if (isListening || isLoggingIn) {
      return;
    }

    setSubmitted(false);
    setLoginError('');
    setVoiceStatus('Escuchando correo...');
    setIsListening(true);

    try {
      const spokenEmail = await listenOnce({
        prompt: 'Decime tu correo electrónico. Podés decir arroba y punto.',
        contextualStrings: ['arroba', 'punto', 'gmail', 'hotmail', 'outlook'],
      });
      const nextEmail = normalizeSpokenEmail(spokenEmail);

      setEmail(nextEmail);
      setVoiceStatus('Correo cargado. Escuchando contraseña...');
      await speak(`Escuché ${nextEmail}. Ahora decime tu contraseña.`);

      const spokenPassword = await listenOnce({
        contextualStrings: ['contraseña', 'clave'],
      });
      const nextPassword = normalizeSpokenPassword(spokenPassword);

      setPassword(nextPassword);
      setVoiceStatus('Contraseña cargada.');
      await speak('Contraseña cargada. Tocá iniciar sesión para entrar.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No pude escucharte. Probá de nuevo.';

      setVoiceStatus(message);
      await speak(message);
    } finally {
      setIsListening(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <View style={styles.bottomGlow} />

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={styles.brandBlock}>
              <Image
                accessibilityLabel="ANNY"
                resizeMode="contain"
                source={require('@/assets/images/logo-white.png')}
                style={styles.logo}
              />

              <Text style={styles.headline}>Iniciar sesión</Text>
            </View>

            <View style={styles.formPanel}>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Correo electrónico</Text>
                <View style={[styles.inputShell, submitted && errors.email ? styles.inputShellError : null]}>
                  <TextInput
                    accessibilityLabel="Correo electrónico"
                    autoCapitalize="none"
                    autoComplete="email"
                    inputMode="email"
                    keyboardType="email-address"
                    onChangeText={handleEmailChange}
                    placeholder="tu@email.com"
                    placeholderTextColor="#707989"
                    style={styles.input}
                    value={email}
                  />
                </View>
                {submitted && errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Contraseña</Text>
                <View style={[styles.inputShell, submitted && errors.password ? styles.inputShellError : null]}>
                  <TextInput
                    accessibilityLabel="Contraseña"
                    autoCapitalize="none"
                    autoComplete="password"
                    onChangeText={handlePasswordChange}
                    onSubmitEditing={handleLogin}
                    placeholder="Mínimo 8 caracteres"
                    placeholderTextColor="#707989"
                    secureTextEntry={!isPasswordVisible}
                    style={styles.input}
                    value={password}
                  />
                  <Pressable
                    accessibilityLabel={isPasswordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    accessibilityRole="button"
                    onPress={() => setIsPasswordVisible((visible) => !visible)}
                    style={({ pressed }) => [styles.passwordToggle, pressed ? styles.passwordTogglePressed : null]}>
                    <Ionicons
                      color="#6F5873"
                      name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                      size={22}
                    />
                  </Pressable>
                </View>
                {submitted && errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
              </View>

              <Pressable
                accessibilityLabel={isListening ? 'Anny está escuchando' : 'Dictar correo y contraseña'}
                accessibilityRole="button"
                disabled={isListening || isLoggingIn}
                onPress={handleVoiceLogin}
                style={({ pressed }) => [
                  styles.voiceLoginButton,
                  pressed ? styles.voiceLoginButtonPressed : null,
                  isListening ? styles.voiceLoginButtonActive : null,
                ]}>
                <Ionicons color="#FFFFFF" name={isListening ? 'radio' : 'mic-outline'} size={21} />
                <Text style={styles.voiceLoginText}>{isListening ? 'Escuchando...' : 'Hablar con Anny'}</Text>
              </Pressable>
              {voiceStatus ? <Text style={styles.voiceStatusText}>{voiceStatus}</Text> : null}

              {loginError ? (
                <View accessibilityRole="alert" style={styles.serverErrorBox}>
                  <Text style={styles.serverErrorText}>{loginError}</Text>
                </View>
              ) : null}

              <Pressable
                accessibilityLabel="Entrar a mi cuenta"
                onPress={handleLogin}
                disabled={isLoggingIn}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed ? styles.primaryButtonPressed : null,
                  isLoggingIn ? styles.primaryButtonDisabled : null,
                ]}>
                <Text style={styles.primaryButtonText}>{isLoggingIn ? 'Iniciando...' : 'Iniciar sesión'}</Text>
              </Pressable>

              <Link href={'/onboarding' as Href} asChild>
                <Pressable accessibilityLabel="Ver pasos ANNY para usar la app por primera vez" style={styles.firstTimeButton}>
                  <Text style={styles.firstTimeEyebrow}>¿Primera vez en ANNY?</Text>
                  <Text style={styles.firstTimeText}>Ver pasos ANNY</Text>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F2EDF3',
  },
  topGlow: {
    position: 'absolute',
    top: -160,
    right: -130,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(60, 22, 66, 0.08)',
  },
  bottomGlow: {
    position: 'absolute',
    bottom: -180,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(60, 22, 66, 0.06)',
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingTop: 30,
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: 16,
  },
  logo: {
    width: 132,
    height: 112,
    marginBottom: 12,
    tintColor: '#3C1642',
  },
  headline: {
    color: '#3C1642',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 0,
  },
  formPanel: {
    borderTopLeftRadius: 50,
    borderTopRightRadius: 50,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 32,
    paddingTop: 34,
    paddingBottom: 28,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: -2 },
    elevation: 5,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  label: {
    color: '#3C1642',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  inputShell: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#D8CFDA',
    backgroundColor: '#FFFFFF',
  },
  inputShellError: {
    borderColor: '#FF6B7A',
  },
  input: {
    flex: 1,
    color: '#212121',
    fontSize: 16,
    paddingHorizontal: 14,
  },
  passwordToggle: {
    width: 46,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordTogglePressed: {
    opacity: 0.7,
  },
  errorText: {
    color: '#FF8F9A',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  voiceLoginButton: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: '#D8CFDA',
    borderRadius: 24,
    backgroundColor: '#C1B5C3',
    marginBottom: 12,
  },
  voiceLoginButtonPressed: {
    opacity: 0.82,
  },
  voiceLoginButtonActive: {
    borderColor: '#3C1642',
    backgroundColor: '#6A0DAD',
  },
  voiceLoginText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  voiceStatusText: {
    color: '#3C1642',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    textAlign: 'center',
    marginTop: -4,
    marginBottom: 12,
  },
  serverErrorBox: {
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 122, 0.45)',
    borderRadius: 12,
    backgroundColor: 'rgba(255, 107, 122, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  serverErrorText: {
    color: '#FFB3BC',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    textAlign: 'center',
  },
  primaryButton: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
    backgroundColor: '#6A0DAD',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  primaryButtonPressed: {
    opacity: 0.82,
  },
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  firstTimeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 6,
  },
  firstTimeEyebrow: {
    color: '#6F5873',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  firstTimeText: {
    color: '#3C1642',
    fontSize: 15,
    fontWeight: '700',
  },
});
