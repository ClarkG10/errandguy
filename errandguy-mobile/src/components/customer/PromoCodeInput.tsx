import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import * as Haptics from 'expo-haptics';
import { X, Check, Tag } from 'lucide-react-native';
import { Eyebrow } from '../ui/Typography';
import { Spinner } from '../ui/Spinner';
import { configService } from '../../services/config.service';
import { LightColors } from '../../constants/colors';
import { copy } from '../../constants/copy';
import { errorMessage } from '../../utils/errorCatalog';
import { formatCurrency } from '../../utils/formatCurrency';

interface PromoCodeInputProps {
  appliedCode: string | undefined;
  /** Validated saving in pesos for `appliedCode`. Shown in the applied chip
   *  so the discount stays visible even where no breakdown line exists
   *  (negotiate mode, rehydrated drafts). */
  appliedDiscount?: number;
  /** Current booking fare (pre-discount). Sent to the validate endpoint so the
   *  server can enforce min_order and compute percentage discounts against the
   *  real amount — without it, min-order promos are rejected and percentage
   *  promos preview ₱0. */
  amount?: number;
  onApply: (code: string, discount: number) => void;
  onRemove: () => void;
}

export function PromoCodeInput({
  appliedCode,
  appliedDiscount = 0,
  amount,
  onApply,
  onRemove,
}: PromoCodeInputProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);

  const handleApply = useCallback(async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await configService.validatePromo(code.trim(), amount);
      const data = res.data.data;
      // Outcome haptic — promo validated and applied.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
      // Backend /promos/validate returns the peso saving under `discount`
      // (PromoService.php), not `discount_amount`. Reading the wrong key made
      // the applied-promo chip + review breakdown show a ₱0 saving even for a
      // valid code (the real discount still applied server-side at booking).
      onApply(code.trim(), data?.discount ?? 0);
      setCode('');
    } catch (err: any) {
      // Outcome haptic — invalid/rejected code, paired with the inline
      // error text below (no shake animation by design).
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => {},
      );
      setError(errorMessage(err, copy.promo.applyFailed));
    } finally {
      setLoading(false);
    }
  }, [code, amount, onApply]);

  if (appliedCode) {
    return (
      <View className="mb-4">
        <Eyebrow className="mb-2">Promo code</Eyebrow>
        {/* h-14 matches the input row below so applying/removing a code
            never shifts the payment section under it. successSoft +
            successDark text (not success/10 + success): the base green
            measured ~2.8:1 on the tinted wash — under AA for 13px. */}
        <View className="flex-row items-center bg-successSoft rounded-2xl px-4 h-14">
          <Tag size={16} color={LightColors.success} />
          <Text
            className="text-sm font-montserrat-bold text-successDark ml-2 flex-1"
            numberOfLines={1}
          >
            {appliedCode}
            {appliedDiscount > 0 ? (
              <Text className="font-montserrat-semi">
                {' '}— you save {formatCurrency(appliedDiscount)}
              </Text>
            ) : null}
          </Text>
          <Check size={16} color={LightColors.success} />
          <Pressable
            onPress={onRemove}
            className="ml-2"
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Remove promo code"
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
          >
            <X size={16} color={LightColors.textSecondary} />
          </Pressable>
        </View>
      </View>
    );
  }

  // Single bordered row with the Apply button living inline as a
  // right-side adornment. This guarantees pixel-perfect vertical
  // alignment between the input and the button regardless of font
  // metrics or label/error helper height (the previous floating-label
  // Input had a baked-in 16px wrapper margin that visually offset
  // the Apply pill from the field).
  const disabled = loading || !code.trim();

  return (
    <View className="mb-4">
      <Eyebrow className="mb-2">Promo code</Eyebrow>
      <View
        className={`flex-row items-center bg-surface rounded-2xl border h-14 pl-4 pr-1 ${
          error
            ? 'border-danger'
            : focused
            ? 'border-primary'
            : 'border-divider'
        }`}
      >
        <Tag size={16} color={LightColors.textMuted} />
        <TextInput
          value={code}
          onChangeText={(t) => {
            setCode(t.toUpperCase());
            if (error) setError('');
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={handleApply}
          placeholder="Enter promo code"
          placeholderTextColor={LightColors.textMuted}
          accessibilityLabel="Promo code"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          className="flex-1 text-sm font-montserrat text-textPrimary mx-2"
          style={{ paddingVertical: 0 }}
        />
        <Pressable
          className={`h-12 px-4 rounded-xl items-center justify-center ${
            disabled ? 'bg-divider' : 'bg-primary'
          }`}
          onPress={handleApply}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Apply promo code"
          style={({ pressed }) => (pressed && !disabled ? { opacity: 0.85 } : null)}
        >
          {loading ? (
            <Spinner size="small" color={LightColors.textInverse} />
          ) : (
            <Text
              className={`text-sm font-montserrat-bold ${
                disabled ? 'text-textMuted' : 'text-white'
              }`}
            >
              Apply
            </Text>
          )}
        </Pressable>
      </View>
      {!!error && (
        // dangerDark per the small-status-text rung — base danger is
        // ~3.8:1 on this canvas, under the 4.5:1 floor for 12px text.
        <Text
          className="text-xs font-montserrat text-dangerDark mt-1.5 ml-1"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
    </View>
  );
}
