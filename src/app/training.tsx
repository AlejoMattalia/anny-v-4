import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  trainingActivities,
  trainingLevels,
  trainingModules,
  trainingSections,
  trainingSteps,
  type TrainingActivity,
  type TrainingModule,
} from '@/lib/training-data';
import { speak } from '@/lib/voice';

export default function TrainingScreen() {
  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(null);

  useEffect(() => {
    void speak(
      'Capacitaciones. Nivel básico. Elegí un módulo para escuchar sus actividades y pasos. Esta sección replica las capacitaciones de Anny.',
    );
  }, []);

  function selectModule(module: TrainingModule) {
    setSelectedModuleId((currentModuleId) => {
      const nextModuleId = currentModuleId === module.idModule ? null : module.idModule;
      if (nextModuleId !== null) {
        void speak(`Módulo: ${module.titleModule}`);
      }
      return nextModuleId;
    });
  }

  function getModuleActivities(moduleId: number) {
    return trainingActivities.filter((activity) => activity.idModule === moduleId).sort((a, b) => a.order - b.order);
  }

  function getActivitySteps(activityId: number) {
    return trainingSteps.filter((step) => step.idActivity === activityId).sort((a, b) => a.order - b.order);
  }

  function speakActivity(activity: TrainingActivity) {
    const steps = getActivitySteps(activity.idActivity);
    const stepText = steps.length
      ? `Pasos. ${steps.map((step, index) => `Paso ${index + 1}: ${step.descriptionStep}`).join(' ')}`
      : 'No hay pasos disponibles para esta actividad.';

    void speak(`Actividad: ${activity.titleActivity}. ${activity.descriptionActivity}. ${stepText}`);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Volver al inicio" onPress={() => router.replace('/home')} style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Capacitaciones</Text>
          </View>
          <View style={styles.levelBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="school-outline" size={24} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.levelText}>Nivel {trainingLevels[0]?.titleLevel ?? 'Básico'}</Text>
          {trainingSections
            .sort((a, b) => a.order - b.order)
            .map((section) => (
              <View key={section.idSection} style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>{section.titleSection}</Text>
                {trainingModules
                  .filter((module) => module.idSection === section.idSection)
                  .sort((a, b) => a.order - b.order)
                  .map((module) => {
                    const isActive = module.idModule === selectedModuleId;
                    const activities = getModuleActivities(module.idModule);

                    return (
                      <View key={module.idModule} style={[styles.moduleCard, isActive ? styles.moduleCardActive : null]}>
                        <Pressable
                          accessibilityLabel={`Módulo ${module.titleModule}`}
                          accessibilityRole="button"
                          onPress={() => selectModule(module)}
                          style={({ pressed }) => [styles.moduleHeader, pressed ? styles.pressed : null]}>
                          <View style={[styles.moduleIcon, isActive ? styles.moduleIconActive : null]}>
                            <Text style={styles.moduleIconText}>{module.order}</Text>
                          </View>
                          <View style={styles.moduleText}>
                            <Text style={[styles.moduleTitle, isActive ? styles.moduleTitleActive : null]}>{module.titleModule}</Text>
                            <Text style={styles.moduleMeta}>
                              {activities.length} {activities.length === 1 ? 'actividad' : 'actividades'}
                            </Text>
                          </View>
                          <Ionicons color={isActive ? '#B18CFF' : '#7F8A9B'} name={isActive ? 'chevron-up' : 'chevron-down'} size={20} />
                        </Pressable>

                        {isActive ? (
                          <View style={styles.moduleDetails}>
                            <Text style={styles.detailLabel}>Actividades</Text>
                            {activities.length ? (
                              activities.map((activity, index) => {
                                const steps = getActivitySteps(activity.idActivity);

                                return (
                                  <View key={activity.idActivity} style={styles.activityCard}>
                                    <View style={styles.activityTop}>
                                      <View style={styles.activityNumber}>
                                        <Text style={styles.activityNumberText}>{index + 1}</Text>
                                      </View>
                                      <View style={styles.activityTitleWrap}>
                                        <Text style={styles.activityType}>{activity.typeActivity}</Text>
                                        <Text style={styles.activityTitle}>{activity.titleActivity}</Text>
                                      </View>
                                    </View>
                                    <View style={styles.stepsList}>
                                      {steps.length ? (
                                        steps.map((step, stepIndex) => (
                                          <View key={step.idStep} style={styles.stepRow}>
                                            <Text style={styles.stepIndex}>{stepIndex + 1}</Text>
                                            <Text style={styles.stepText}>{step.descriptionStep}</Text>
                                          </View>
                                        ))
                                      ) : (
                                        <Text style={styles.emptySteps}>No hay pasos disponibles.</Text>
                                      )}
                                    </View>

                                    <Pressable
                                      accessibilityLabel={`Escuchar actividad ${activity.titleActivity}`}
                                      onPress={() => speakActivity(activity)}
                                      style={({ pressed }) => [styles.listenButton, pressed ? styles.listenButtonPressed : null]}>
                                      <MaterialCommunityIcons color="#B18CFF" name="volume-high" size={17} />
                                      <Text style={styles.listenButtonText}>Escuchar</Text>
                                    </Pressable>
                                  </View>
                                );
                              })
                            ) : (
                              <View style={styles.emptyPanel}>
                                <Text style={styles.emptyTitle}>Sin actividades</Text>
                                <Text style={styles.emptyText}>Este módulo todavía no tiene actividades cargadas.</Text>
                              </View>
                            )}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
              </View>
            ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#05070B',
  },
  topGlow: {
    position: 'absolute',
    top: -170,
    right: -120,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: 'rgba(141, 91, 255, 0.18)',
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
    borderColor: '#1D2633',
    backgroundColor: '#0D141D',
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '900',
  },
  subtitle: {
    color: '#B18CFF',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  levelBadge: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: '#8D5BFF',
  },
  summaryPanel: {
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: 'rgba(12, 17, 24, 0.94)',
    padding: 12,
    marginBottom: 10,
  },
  summaryTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4,
  },
  summaryText: {
    color: '#AEB7C7',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  content: {
    paddingBottom: 18,
  },
  levelText: {
    color: '#B18CFF',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 10,
  },
  sectionBlock: {
    marginBottom: 14,
  },
  sectionTitle: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  moduleCard: {
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    marginBottom: 10,
    overflow: 'hidden',
  },
  moduleCardActive: {
    borderColor: '#8D5BFF',
    backgroundColor: 'rgba(141, 91, 255, 0.11)',
  },
  moduleHeader: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pressed: {
    opacity: 0.82,
  },
  moduleIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#151D28',
    borderWidth: 1,
    borderColor: '#263244',
  },
  moduleIconActive: {
    backgroundColor: '#8D5BFF',
    borderColor: '#B18CFF',
  },
  moduleIconText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  moduleText: {
    flex: 1,
    minWidth: 0,
  },
  moduleTitle: {
    color: '#D9DEEA',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18,
  },
  moduleTitleActive: {
    color: '#FFFFFF',
  },
  moduleMeta: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
  },
  moduleDetails: {
    borderTopWidth: 1,
    borderTopColor: '#1D2633',
    padding: 12,
    paddingTop: 11,
  },
  detailLabel: {
    color: '#B18CFF',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 9,
  },
  activityCard: {
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#101721',
    padding: 11,
    marginBottom: 10,
  },
  activityTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  activityNumber: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#208AEF',
  },
  activityNumberText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  activityTitleWrap: {
    flex: 1,
  },
  activityType: {
    color: '#B18CFF',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  activityTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18,
    marginTop: 1,
  },
  activityDescription: {
    color: '#AEB7C7',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  stepsList: {
    marginTop: 9,
    gap: 6,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 7,
  },
  stepIndex: {
    width: 18,
    height: 18,
    overflow: 'hidden',
    borderRadius: 9,
    color: '#FFFFFF',
    backgroundColor: '#1D2633',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 18,
    textAlign: 'center',
  },
  stepText: {
    flex: 1,
    color: '#D9DEEA',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  emptySteps: {
    color: '#7F8A9B',
    fontSize: 10,
    fontWeight: '700',
  },
  listenButton: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A3342',
    backgroundColor: '#151D28',
    marginTop: 10,
  },
  listenButtonPressed: {
    opacity: 0.82,
  },
  listenButtonText: {
    color: '#B18CFF',
    fontSize: 12,
    fontWeight: '900',
  },
  emptyPanel: {
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    padding: 14,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4,
  },
  emptyText: {
    color: '#AEB7C7',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
});
