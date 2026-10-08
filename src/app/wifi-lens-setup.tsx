import { Redirect } from 'expo-router';

// La conexión manual por IP fue reemplazada por el flujo de redes de v3.
export default function WifiLensSetup() {
  return <Redirect href="/glasses-network" />;
}
