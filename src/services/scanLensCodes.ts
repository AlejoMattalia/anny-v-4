import { scanFromURLAsync, type BarcodeType } from 'expo-camera';
import { NativeModules, Platform } from 'react-native';

export async function scanLensCodes(frame: string, types: BarcodeType[]): Promise<{ type: string; data: string }[]> {
  if (Platform.OS === 'ios') {
    const reader = NativeModules.AnnyLensBarcode;
    if (!reader?.scan) throw new Error('Actualizá Anny para leer códigos con los lentes en iPhone.');
    const results: { type: BarcodeType; data: string }[] = await reader.scan(frame);
    return results.filter(result => types.includes(result.type));
  }
  return scanFromURLAsync(`data:image/jpeg;base64,${frame}`, types);
}
