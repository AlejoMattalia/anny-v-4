export type TrainingLevel = {
  idLevel: number;
  titleLevel: string;
  order: number;
};

export type TrainingSection = {
  idSection: number;
  idLevel: number;
  titleSection: string;
  order: number;
};

export type TrainingModule = {
  idModule: number;
  idSection: number;
  titleModule: string;
  order: number;
};

export type TrainingActivity = {
  idActivity: number;
  typeActivity: string;
  idModule: number;
  titleActivity: string;
  descriptionActivity: string;
  order: number;
};

export type TrainingStep = {
  idStep: number;
  idActivity: number;
  descriptionStep: string;
  order: number;
};

export const trainingLevels: TrainingLevel[] = [
  { idLevel: 1, titleLevel: 'Básico', order: 1 },
];

export const trainingSections: TrainingSection[] = [
  { idSection: 1, idLevel: 1, titleSection: 'Sección 1', order: 1 },
  { idSection: 2, idLevel: 1, titleSection: 'Sección 2', order: 2 },
  { idSection: 3, idLevel: 1, titleSection: 'Sección 3', order: 3 },
];

export const trainingModules: TrainingModule[] = [
  { idModule: 1, idSection: 1, titleModule: 'Técnicas de protección personal', order: 1 },
  { idModule: 2, idSection: 1, titleModule: 'Familiarización de interiores', order: 2 },
  { idModule: 3, idSection: 2, titleModule: 'Localización de objetos caídos', order: 1 },
  { idModule: 4, idSection: 2, titleModule: 'Localización de objetos específicos', order: 2 },
  { idModule: 5, idSection: 2, titleModule: 'Actividad por definir', order: 3 },
  { idModule: 6, idSection: 3, titleModule: 'Actividad por definir', order: 1 },
];

export const trainingActivities: TrainingActivity[] = [
  {
    idActivity: 1,
    typeActivity: 'actividad práctica',
    idModule: 1,
    titleActivity: 'Protección personal alta',
    descriptionActivity:
      'Esta técnica se utiliza para que tu mano sea la que entre en contacto con un obstáculo que sea peligroso para la parte superior del cuerpo.',
    order: 1,
  },
  {
    idActivity: 2,
    typeActivity: 'actividad práctica',
    idModule: 1,
    titleActivity: 'Protección personal baja',
    descriptionActivity: 'Descripción de la actividad 2',
    order: 2,
  },
  {
    idActivity: 3,
    typeActivity: 'actividad práctica',
    idModule: 1,
    titleActivity: 'Combinación de ambas técnicas',
    descriptionActivity: 'Descripción de la actividad 3',
    order: 3,
  },
  {
    idActivity: 4,
    typeActivity: 'actividad práctica',
    idModule: 1,
    titleActivity: 'Incorporación de anteojos Anny',
    descriptionActivity: 'Descripción de la actividad 4',
    order: 4,
  },
  {
    idActivity: 5,
    typeActivity: 'actividad informativa',
    idModule: 2,
    titleActivity: 'Actividad 5',
    descriptionActivity: 'Descripción de la actividad 5',
    order: 1,
  },
  {
    idActivity: 6,
    typeActivity: 'actividad informativa',
    idModule: 3,
    titleActivity: 'Actividad 6',
    descriptionActivity: 'Descripción de la actividad 6',
    order: 1,
  },
  {
    idActivity: 7,
    typeActivity: 'actividad práctica',
    idModule: 4,
    titleActivity: 'Localización de objetos con sonidos',
    descriptionActivity: 'Esta actividad ayuda a localizar objetos específicos mediante el uso de sonidos.',
    order: 1,
  },
  {
    idActivity: 8,
    typeActivity: 'actividad práctica',
    idModule: 4,
    titleActivity: 'Identificación táctil de objetos',
    descriptionActivity: 'Se practica la identificación de objetos específicos mediante el tacto.',
    order: 2,
  },
  {
    idActivity: 9,
    typeActivity: 'actividad informativa',
    idModule: 5,
    titleActivity: 'Conceptos básicos',
    descriptionActivity: 'Descripción de conceptos básicos necesarios para la actividad.',
    order: 1,
  },
  {
    idActivity: 10,
    typeActivity: 'actividad práctica',
    idModule: 6,
    titleActivity: 'Práctica avanzada',
    descriptionActivity: 'Ejercicios avanzados para consolidar el aprendizaje.',
    order: 1,
  },
];

export const trainingSteps: TrainingStep[] = [
  { idStep: 1, idActivity: 1, descriptionStep: 'Extensión de brazo al frente a la altura del hombre.', order: 1 },
  {
    idStep: 2,
    idActivity: 1,
    descriptionStep: 'Flexión altura del codo, ángulo recto, mano a la altura del hombro opuesto.',
    order: 2,
  },
  {
    idStep: 3,
    idActivity: 1,
    descriptionStep: 'Gira la palma externamente con los dedos juntos y estirados.',
    order: 3,
  },
  { idStep: 4, idActivity: 2, descriptionStep: 'Paso 2', order: 1 },
  { idStep: 5, idActivity: 3, descriptionStep: 'Paso 3', order: 1 },
  { idStep: 6, idActivity: 3, descriptionStep: 'Paso 3.1', order: 2 },
  { idStep: 7, idActivity: 4, descriptionStep: 'Paso 1', order: 1 },
  { idStep: 8, idActivity: 5, descriptionStep: 'Paso 1', order: 1 },
  { idStep: 9, idActivity: 5, descriptionStep: 'Paso 2', order: 2 },
  { idStep: 10, idActivity: 6, descriptionStep: 'Paso 1', order: 1 },
  { idStep: 11, idActivity: 7, descriptionStep: 'Paso 1: Identificar la fuente del sonido.', order: 1 },
  { idStep: 12, idActivity: 7, descriptionStep: 'Paso 2: Moverse hacia la dirección del sonido.', order: 2 },
  { idStep: 13, idActivity: 8, descriptionStep: 'Paso 1: Tocar y explorar el objeto.', order: 1 },
  { idStep: 14, idActivity: 8, descriptionStep: 'Paso 2: Identificar características distintivas.', order: 2 },
  { idStep: 15, idActivity: 9, descriptionStep: 'Paso 1', order: 1 },
  { idStep: 16, idActivity: 10, descriptionStep: 'Paso 1', order: 1 },
  { idStep: 17, idActivity: 10, descriptionStep: 'Paso 2', order: 2 },
];
