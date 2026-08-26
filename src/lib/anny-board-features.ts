import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

export type AnnyBoardFeature = {
  accent: string;
  background: string;
  description: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  id: string;
  route: string;
  title: string;
};

/**
 * Functions exposed by the new Anny ESP32 board.
 *
 * Keep board capabilities in this registry so adding a new one only requires
 * its screen plus one entry here; the board section does not need to be
 * redesigned for every firmware capability.
 */
export const ANNY_BOARD_FEATURES = [
  {
    accent: '#72D68B',
    background: 'rgba(77, 170, 87, 0.14)',
    description: 'Ver en vivo las cámaras de los lentes vinculados a tu cuenta',
    icon: 'video-wireless-outline',
    id: 'streaming',
    route: '/remote-cameras',
    title: 'Streaming en tiempo real',
  },
] as const satisfies readonly AnnyBoardFeature[];
