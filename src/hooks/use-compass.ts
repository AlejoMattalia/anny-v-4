import { useEffect, useState } from 'react';
import { Magnetometer } from 'expo-sensors';
import { Subscription } from 'expo-modules-core';

export function useCompass(isActive: boolean) {
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    // Set update interval to 150ms for a good balance between responsiveness and performance
    Magnetometer.setUpdateInterval(150);

    let subscription: Subscription | null = null;

    try {
      subscription = Magnetometer.addListener((data) => {
        // x and y represent the geomagnetic field components along the device's axes
        // To find the heading of the top of the phone (Y-axis) relative to magnetic north:
        // angle is computed as Math.atan2(x, y)
        let angle = Math.atan2(data.x, data.y) * (180 / Math.PI);

        // Normalize angle to [0, 360)
        if (angle < 0) {
          angle += 360;
        }

        // Round to avoid continuous micro-updates/jitter
        setHeading(Math.round(angle));
      });
    } catch (error) {
      console.warn('El magnetómetro no está disponible en este dispositivo:', error);
    }

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [isActive]);

  return isActive ? heading : null;
}
