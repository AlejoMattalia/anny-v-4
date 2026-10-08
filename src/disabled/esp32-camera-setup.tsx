import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { provisionEsp32Camera } from '@/lib/esp32-camera-provisioning';
import { claimRemoteCamera } from '@/lib/remote-cameras';

type ClaimedCamera = { activationCode: string; cameraId: string; deviceSecret: string };

export default function Esp32CameraSetupScreen() {
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [claimedCamera, setClaimedCamera] = useState<ClaimedCamera | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function configure() {
    const normalizedCode = activationCode.trim().toUpperCase();
    if (!wifiSsid.trim() || !normalizedCode) {
      setMessage('Ingresá el WiFi y el código de activación.');
      return;
    }
    try {
      setBusy(true);
      let credentials = claimedCamera?.activationCode === normalizedCode ? claimedCamera : null;
      if (!credentials) {
        setMessage('Validando el código de activación…');
        const claimed = await claimRemoteCamera(normalizedCode);
        if (!claimed.deviceSecret) {
          throw new Error('El servidor no devolvió la credencial de la placa. Actualizá el servicio de cámaras.');
        }
        credentials = {
          activationCode: normalizedCode,
          cameraId: claimed.camera.id,
          deviceSecret: claimed.deviceSecret,
        };
        setClaimedCamera(credentials);
      }
      setMessage('Código válido. Buscando la placa por Bluetooth…');
      await provisionEsp32Camera({
        wifiSsid,
        wifiPassword,
        cameraId: credentials.cameraId,
        deviceSecret: credentials.deviceSecret,
      });
      setWifiPassword('');
      setMessage('Configuración enviada por Bluetooth. La placa se reiniciará y se conectará al WiFi indicado.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo configurar la placa.'); }
    finally { setBusy(false); }
  }

  return <View style={styles.screen}><SafeAreaView style={styles.safeArea}>
    <View style={styles.header}>
      <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}><Ionicons color="#FFF" name="chevron-back" size={24} /></Pressable>
      <View style={{ flex: 1 }}><Text style={styles.title}>Lentes con cámara ESP32</Text><Text style={styles.subtitle}>Configuración por Bluetooth</Text></View>
      <MaterialCommunityIcons color="#72D68B" name="video-wireless-outline" size={28} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.info}><Text style={styles.infoTitle}>Configurar lente</Text>
        <Text style={styles.infoText}>Encendé el lente y activá Bluetooth. Anny encontrará la placa y enviará la configuración automáticamente.</Text>
        <Text style={styles.infoText}>El código vincula el lente con tu cuenta y configura automáticamente su identidad en la placa. El servidor permanece fijo.</Text>
        <Field
          autoCapitalize="characters"
          label="Código de activación"
          maxLength={8}
          onChangeText={(value) => { setActivationCode(value.toUpperCase()); setClaimedCamera(null); }}
          placeholder="5DF6D89F"
          value={activationCode}
        />
        <Field label="Nombre del WiFi" value={wifiSsid} onChangeText={setWifiSsid} />
        <Field label="Contraseña del WiFi" value={wifiPassword} onChangeText={setWifiPassword} secureTextEntry />
        <Pressable disabled={busy} onPress={() => void configure()} style={[styles.button, busy && { opacity: .6 }]}>{busy ? <ActivityIndicator color="#FFF" /> : <MaterialCommunityIcons color="#FFF" name="send" size={19} />}<Text style={styles.buttonText}>Enviar a la placa</Text></Pressable>
      </View>
      {message ? <View accessibilityRole="alert" style={styles.message}><Text style={styles.messageText}>{message}</Text></View> : null}
    </ScrollView>
  </SafeAreaView></View>;
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...inputProps } = props;
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput placeholderTextColor="#596474" style={styles.input} {...inputProps} /></View>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#FCFCFC'},safeArea:{flex:1,paddingHorizontal:14},header:{minHeight:70,flexDirection:'row',alignItems:'center',gap:11},back:{width:38,height:38,alignItems:'center',justifyContent:'center',borderRadius:8,backgroundColor:'#F2EDF3'},title:{color:'#FFF',fontSize:17,fontWeight:'900'},subtitle:{color:'#6F5873',fontSize:11,marginTop:3},content:{gap:12,paddingBottom:34},info:{gap:10,borderWidth:1,borderColor:'#DED5E0',borderRadius:12,backgroundColor:'#FFFFFF',padding:14},infoTitle:{color:'#FFF',fontSize:15,fontWeight:'900'},infoText:{color:'#5B465F',fontSize:12,lineHeight:18},button:{minHeight:46,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:9,backgroundColor:'#4DAA57'},buttonText:{color:'#FFF',fontWeight:'900'},field:{gap:5},label:{color:'#5B465F',fontSize:11,fontWeight:'800'},input:{minHeight:44,color:'#FFF',borderWidth:1,borderColor:'#DED5E0',borderRadius:8,backgroundColor:'#F6F2F7',paddingHorizontal:12},message:{borderWidth:1,borderColor:'#315C43',borderRadius:10,backgroundColor:'rgba(77,170,87,.1)',padding:12},messageText:{color:'#B8E5C4',lineHeight:18},
});
