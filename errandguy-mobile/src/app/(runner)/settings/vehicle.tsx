import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Check, PersonStanding, Bike, Motorbike, Car } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { LightColors } from '../../../constants/colors';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Spinner } from '../../../components/ui/Spinner';
import { Eyebrow } from '../../../components/ui/Typography';
import { Radius } from '../../../constants/radius';
import { useResponsive } from '../../../constants/responsive';
import { useRunnerStore } from '../../../stores/runnerStore';
import { runnerService } from '../../../services/runner.service';
import type { VehicleType } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';

// Bicycle and Motorcycle used to share the `Bike` glyph (older Lucide had no
// motorcycle), so the two tiles read as one at a glance.
const VEHICLE_OPTIONS: { type: VehicleType; label: string; Icon: LucideIcon }[] = [
  { type: 'walk', label: 'Walking', Icon: PersonStanding },
  { type: 'bicycle', label: 'Bicycle', Icon: Bike },
  { type: 'motorcycle', label: 'Motorcycle', Icon: Motorbike },
  { type: 'car', label: 'Car', Icon: Car },
];

const needsPlate = (t: VehicleType | null) => t === 'motorcycle' || t === 'car';

export default function VehicleScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const { runnerProfile, setRunnerProfile } = useRunnerStore();

  // Nothing preselected when no vehicle is saved. Walking used to be, with
  // Save live — so a motorcycle rider tapping straight through saved
  // "Walking" and was only ever offered walking errands. The runner picks.
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(
    runnerProfile?.vehicle_type ?? null,
  );
  const [plate, setPlate] = useState(runnerProfile?.vehicle_plate ?? '');
  const [plateError, setPlateError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  // Snapshot the opening values so the Save CTA and discard guard can tell
  // whether anything actually changed.
  const initial = useRef({
    type: runnerProfile?.vehicle_type ?? null,
    plate: runnerProfile?.vehicle_plate ?? '',
  });

  // Opened before the profile is in the store (a cold start, or straight from
  // a "add your vehicle" prompt): the form used to seed once from nothing and
  // show a runner with a car on file an empty picker. Load it here, hold the
  // form until it lands, then seed from it.
  const profileMissing = !runnerProfile;
  const [profileError, setProfileError] = useState<unknown>(null);
  const [profileAttempt, setProfileAttempt] = useState(0);
  useEffect(() => {
    if (!profileMissing) return;
    let cancelled = false;
    setProfileError(null);
    runnerService
      .getRunnerProfile()
      .then((res) => {
        if (!cancelled && res.data?.data) setRunnerProfile(res.data.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProfileError(err ?? true);
      });
    return () => {
      cancelled = true;
    };
  }, [profileMissing, profileAttempt, setRunnerProfile]);

  const seededRef = useRef(!profileMissing);
  useEffect(() => {
    if (seededRef.current || !runnerProfile) return;
    seededRef.current = true;
    const savedType = runnerProfile.vehicle_type ?? null;
    const savedPlate = runnerProfile.vehicle_plate ?? '';
    initial.current = { type: savedType, plate: savedPlate };
    setVehicleType(savedType);
    setPlate(savedPlate);
  }, [runnerProfile]);

  const dirty =
    vehicleType !== initial.current.type ||
    (needsPlate(vehicleType) && plate.trim() !== initial.current.plate.trim());
  // No vehicle on file yet (only once the profile has loaded — with none in
  // hand we can't tell "nothing saved" from "not fetched yet"). Drives the
  // "Choose your vehicle" copy.
  const nothingSaved = !!runnerProfile && !runnerProfile.vehicle_type;
  // Save stays off until a vehicle is actually chosen; picking one from
  // nothing counts as a change.
  const canSave = vehicleType != null && dirty;

  // Once the user confirms leaving (or a save succeeds) the beforeRemove
  // guard must not re-intercept our own router.back().
  const leavingRef = useRef(false);

  const leaveScreen = useCallback(() => {
    leavingRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(runner)/(tabs)/profile');
  }, [router]);

  const handleBackPress = useCallback(() => {
    if (dirty) setShowDiscardModal(true);
    else leaveScreen();
  }, [dirty, leaveScreen]);

  // Header back runs through handleBackPress, but Android hardware back
  // and the iOS swipe-back gesture pop directly — intercept those too so
  // no path silently drops unsaved edits.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!dirty || leavingRef.current) return;
      e.preventDefault();
      setShowDiscardModal(true);
    });
    return unsub;
  }, [navigation, dirty]);

  const handleSave = async () => {
    if (!vehicleType) return;
    // A motorcycle/car with no plate makes no sense — surface it inline on
    // the field rather than persisting an empty plate.
    if (needsPlate(vehicleType) && !plate.trim()) {
      setPlateError('Plate number is required');
      return;
    }
    setPlateError(undefined);

    setLoading(true);
    try {
      const data: Record<string, string> = {
        vehicle_type: vehicleType,
      };
      if (needsPlate(vehicleType)) {
        data.vehicle_plate = plate.trim().toUpperCase();
      }
      const res = await runnerService.updateRunnerProfile(data);
      setRunnerProfile(res.data.data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.success('Vehicle information updated');
      leaveScreen();
    } catch (err: any) {
      toast.error(errorMessage(err, copy.runner.vehicleSaveFailed));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Vehicle information"
        showBack
        fallbackHref="/(runner)/(tabs)/profile"
        onBackPress={handleBackPress}
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: Math.max(insets.bottom, 12) + 96,
            maxWidth: contentMaxWidth,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          {profileMissing ? (
            profileError ? (
              <ErrorState
                title="Couldn't load your vehicle"
                error={profileError}
                onRetry={() => setProfileAttempt((n) => n + 1)}
                style={{ flex: 0, paddingVertical: 32 }}
              />
            ) : (
              <View className="items-center py-16" accessibilityLabel="Loading your vehicle">
                <Spinner size="small" color={LightColors.primary} />
              </View>
            )
          ) : (
            <>
              <Eyebrow className="mt-5 mb-3 ml-1">
                {nothingSaved ? 'Choose your vehicle' : 'Vehicle type'}
              </Eyebrow>
              {nothingSaved ? (
                <Text className="text-[13px] font-montserrat text-textSecondary -mt-1 mb-4 ml-1">
                  Save the one you’ll use — you can go online once it’s on file, and
                  we only send you errands it can do.
                </Text>
              ) : null}

              <View
                className="flex-row flex-wrap gap-3 mb-6"
                accessibilityRole="radiogroup"
                accessibilityLabel="Vehicle type"
              >
                {VEHICLE_OPTIONS.map((opt) => {
                  const selected = vehicleType === opt.type;
                  return (
                    <Pressable
                      key={opt.type}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setVehicleType(opt.type);
                      }}
                      // 8%-primary ripple, clipped to the rounded corners by
                      // overflow:hidden — the app's canonical selection-tile
                      // feedback. The old opaque primaryLight ripple bled past
                      // the corners on Android and was invisible once selected.
                      android_ripple={{ color: `${LightColors.primary}14`, borderless: false }}
                      accessibilityRole="radio"
                      accessibilityLabel={opt.label}
                      accessibilityState={{ selected }}
                      style={({ pressed }) => [
                        {
                          borderRadius: Radius.card,
                          borderWidth: 1.5,
                          borderColor: selected ? LightColors.primary : LightColors.divider,
                          backgroundColor: selected ? LightColors.primaryLight : LightColors.surface,
                          overflow: 'hidden',
                        },
                        pressed ? { opacity: 0.92, transform: [{ scale: 0.985 }] } : null,
                      ]}
                      className="flex-1 min-w-[45%] p-4 items-center"
                    >
                      <opt.Icon
                        size={26}
                        color={selected ? LightColors.primary : LightColors.textTertiary}
                        strokeWidth={1.8}
                        style={{ marginBottom: 6 }}
                      />
                      <Text
                        className={`text-sm font-montserrat-bold ${
                          selected ? 'text-primary' : 'text-textSecondary'
                        }`}
                      >
                        {opt.label}
                      </Text>
                      {selected && (
                        <View className="absolute top-2 right-2">
                          <Check size={16} color={LightColors.primary} />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>

              {needsPlate(vehicleType) && (
                <>
                  <Eyebrow className="mb-2 ml-1">Plate details</Eyebrow>
                  <Card padding="md">
                    <Input
                      label="Plate Number *"
                      value={plate}
                      onChangeText={(text) => {
                        setPlate(text);
                        if (plateError && text.trim()) setPlateError(undefined);
                      }}
                      placeholder="ABC 1234"
                      autoCapitalize="characters"
                      returnKeyType="done"
                      onSubmitEditing={handleSave}
                      error={plateError}
                    />
                  </Card>
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Inner column clamped to the content width so the CTA matches the
          form column instead of stretching edge-to-edge on a tablet. */}
      <BottomActionBar>
        <View style={{ maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
          <Button
            title={nothingSaved ? 'Save vehicle' : 'Save changes'}
            onPress={handleSave}
            loading={loading}
            loadingTitle="Saving…"
            disabled={!canSave}
            fullWidth
            size="lg"
          />
        </View>
      </BottomActionBar>

      <ConfirmModal
        visible={showDiscardModal}
        title="Discard changes?"
        message="You'll lose the changes you've made to your vehicle details."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setShowDiscardModal(false);
          leaveScreen();
        }}
        onCancel={() => setShowDiscardModal(false)}
      />
    </View>
  );
}
