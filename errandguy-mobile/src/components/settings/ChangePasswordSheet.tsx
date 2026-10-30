import React, { useEffect, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Input, type InputHandle } from '../ui/Input';
import { Button } from '../ui/Button';
import { PasswordStrengthIndicator } from '../auth/PasswordStrengthIndicator';
import { SettingsSheet } from './SettingsSheet';
import { authService } from '../../services/auth.service';
import { currentPushToken } from '../../services/pushToken';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';
import { copy } from '../../constants/copy';
import { errorMessage } from '../../utils/errorCatalog';
import { haptics } from '../../utils/haptics';
import { confirmPasswordRules, newPasswordRules } from '../../utils/validation/passwordPolicy';

interface ChangePasswordForm {
  current_password: string;
  password: string;
  password_confirmation: string;
}

const EMPTY: ChangePasswordForm = { current_password: '', password: '', password_confirmation: '' };
const FIELDS = ['current_password', 'password', 'password_confirmation'] as const;

interface ChangePasswordSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Change the password while signed in (PUT /user/password). Same new-password
 * rules and strength checklist as sign-up and the forgot-password reset. The
 * server signs every OTHER device out; this one stays signed in.
 */
export function ChangePasswordSheet({ visible, onClose }: ChangePasswordSheetProps) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const newRef = useRef<InputHandle>(null);
  const confirmRef = useRef<InputHandle>(null);

  const {
    control,
    handleSubmit,
    watch,
    setError,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordForm>({
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: EMPTY,
  });
  const password = watch('password');

  // Never reopen with the last attempt's passwords still in the fields.
  useEffect(() => {
    if (!visible) {
      reset(EMPTY);
      setNotice(null);
    }
  }, [visible, reset]);

  const onSubmit = async (data: ChangePasswordForm) => {
    setSaving(true);
    setNotice(null);
    try {
      // The push token keeps THIS phone's notifications when the server
      // drops every other device's.
      const res = await authService.changePassword({ ...data, device_token: currentPushToken() });
      // A server that rotates this device's token on a password change hands
      // the new one back; adopt it so the next request isn't signed with a
      // revoked one.
      const fresh = res?.data?.token ?? res?.data?.data?.token;
      if (typeof fresh === 'string' && fresh) {
        await useAuthStore.getState().setToken(fresh);
      }
      haptics.success();
      toast.success(copy.auth.passwordChanged);
      onClose();
    } catch (err) {
      haptics.error();
      // A wrong current password / a rejected new one goes under its field;
      // anything else (network, throttle) is said inside the sheet.
      const fieldErrors = ((err as { errors?: Record<string, unknown> } | null)?.errors ?? {}) as Record<
        string,
        unknown
      >;
      let applied = false;
      for (const field of FIELDS) {
        const raw = fieldErrors[field];
        const message = Array.isArray(raw) ? raw[0] : raw;
        if (typeof message === 'string' && message) {
          setError(field, { type: 'server', message });
          applied = true;
        }
      }
      if (!applied) setNotice(errorMessage(err, 'Couldn’t change your password. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSheet
      visible={visible}
      onClose={onClose}
      busy={saving}
      title="Change password"
      subtitle="You’ll stay signed in here. Every other device will be signed out."
      dismissLabel="Close change password"
      notice={notice}
    >
      <Controller
        control={control}
        name="current_password"
        rules={{ required: 'Enter your current password' }}
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Current Password"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="Your current password"
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => newRef.current?.focus()}
            error={errors.current_password?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        rules={newPasswordRules}
        render={({ field: { onChange, onBlur, value } }) => (
          <>
            <Input
              ref={newRef}
              label="New Password"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="Create a strong password"
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => confirmRef.current?.focus()}
              error={errors.password?.message}
            />
            <PasswordStrengthIndicator password={value} />
          </>
        )}
      />

      <Controller
        control={control}
        name="password_confirmation"
        rules={confirmPasswordRules(() => password)}
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            ref={confirmRef}
            label="Confirm New Password"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="Type it again"
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={handleSubmit(onSubmit)}
            error={errors.password_confirmation?.message}
          />
        )}
      />

      <Button
        title="Change Password"
        fullWidth
        loading={saving}
        loadingTitle="Saving…"
        onPress={handleSubmit(onSubmit)}
      />
      <Button title="Cancel" variant="ghost" fullWidth disabled={saving} onPress={onClose} />
    </SettingsSheet>
  );
}
