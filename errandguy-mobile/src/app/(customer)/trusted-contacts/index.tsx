import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Star,
  Pencil,
  Trash2,
  Phone,
  Users,
  X,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { userService } from '../../../services/user.service';
import { runOptimistic } from '../../../utils/optimistic';
import { errorMessage } from '../../../utils/errorCatalog';
import { haptics } from '../../../utils/haptics';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Card } from '../../../components/ui/Card';
import { Input, type InputHandle } from '../../../components/ui/Input';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Illustration } from '../../../components/ui/Illustration';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ContactIllustration } from '../../../components/auth/OnboardingIllustrations';
import { ContactsSkeleton } from '../../../components/ui/Skeleton';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { LightColors } from '../../../constants/colors';
import { copy } from '../../../constants/copy';
import type { TrustedContact } from '../../../types';
import { toast } from '../../../stores/toastStore';

// expo-contacts requires a native build and is not available in Expo Go.
let Contacts: typeof import('expo-contacts') | null = null;
try {
  Contacts = require('expo-contacts');
} catch {
  // Native module unavailable (e.g. Expo Go)
}

const RELATIONSHIPS = ['Parent', 'Spouse', 'Sibling', 'Friend', 'Other'];
const MAX_CONTACTS = 5;
const CACHE_KEY = '@trusted_contacts_cache';

export default function TrustedContactsScreen() {
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Form modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formRelationship, setFormRelationship] = useState('Friend');
  const [nameError, setNameError] = useState<string | undefined>();
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<TrustedContact | null>(null);

  const insets = useSafeAreaInsets();
  const nameRef = useRef<InputHandle>(null);
  const phoneRef = useRef<InputHandle>(null);

  const saveCache = async (data: TrustedContact[]) => {
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      // Non-critical
    }
  };

  const loadCache = async (): Promise<TrustedContact[] | null> => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const fetchContacts = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const res = await userService.getTrustedContacts();
      const data = res.data.data ?? res.data ?? [];
      const sorted = Array.isArray(data)
        ? data.sort((a: TrustedContact, b: TrustedContact) => a.priority - b.priority)
        : [];
      setContacts(sorted);
      setLoadError(false);
      await saveCache(sorted);
    } catch {
      setLoadError(true);
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchContacts(true);
    setRefreshing(false);
  }, [fetchContacts]);

  useEffect(() => {
    // Load cached data instantly, then sync in background
    const init = async () => {
      const cached = await loadCache();
      if (cached) {
        setContacts(cached);
        setLoading(false);
        // Sync in background without showing skeleton
        await fetchContacts(true);
      } else {
        await fetchContacts(false);
      }
    };
    init();
  }, [fetchContacts]);

  const openAddModal = () => {
    if (contacts.length >= MAX_CONTACTS) {
      toast.warning(`You can only add up to ${MAX_CONTACTS} trusted contacts.`);
      return;
    }
    setEditingId(null);
    setFormName('');
    setFormPhone('');
    setFormRelationship('Friend');
    setNameError(undefined);
    setPhoneError(undefined);
    setModalVisible(true);
  };

  const handleImportFromContacts = async () => {
    if (!Contacts) {
      toast.info('Contact picker is not available on this device.');
      return;
    }
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        toast.info('Allow contacts access to import a contact.');
        return;
      }
      const picked = await Contacts.presentContactPickerAsync();
      if (!picked) return;
      if (picked.name) {
        setFormName(picked.name);
        setNameError(undefined);
      }
      const number = picked.phoneNumbers?.find((p) => p.number)?.number;
      if (number) {
        setFormPhone(number);
        setPhoneError(undefined);
      }
      Haptics.selectionAsync().catch(() => {});
    } catch {
      toast.error('Could not open contacts.');
    }
  };

  const openEditModal = (contact: TrustedContact) => {
    setEditingId(contact.id);
    setFormName(contact.name);
    setFormPhone(contact.phone);
    setFormRelationship(contact.relationship);
    setNameError(undefined);
    setPhoneError(undefined);
    setModalVisible(true);
  };

  const handleNameChange = (text: string) => {
    setFormName(text);
    if (nameError) setNameError(undefined);
  };

  const handlePhoneChange = (text: string) => {
    setFormPhone(text);
    if (phoneError) setPhoneError(undefined);
  };

  const handleSave = async () => {
    const trimmedName = formName.trim();

    // Normalize phone to Philippine format (09XXXXXXXXX)
    let phone = formPhone.trim().replace(/\s+/g, '');
    if (phone.startsWith('+63')) {
      phone = '0' + phone.slice(3);
    } else if (phone.startsWith('63')) {
      phone = '0' + phone.slice(2);
    } else if (!phone.startsWith('0') && phone.startsWith('9')) {
      phone = '0' + phone;
    }

    // Inline field errors are the primary surface (each carries an
    // aria-live alert); focus the first invalid field so the fix is
    // immediate on both touch and screen readers.
    const nErr = !trimmedName ? 'Enter a name for this contact' : undefined;
    const pErr = !formPhone.trim()
      ? 'Enter a phone number'
      : !/^(0)9\d{9}$/.test(phone)
        ? 'Enter a valid Philippine mobile number, e.g. 09XX XXX XXXX'
        : undefined;
    setNameError(nErr);
    setPhoneError(pErr);
    if (nErr || pErr) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      (nErr ? nameRef : phoneRef).current?.focus();
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        phone,
        relationship: formRelationship,
        priority: editingId
          ? contacts.find((c) => c.id === editingId)?.priority ?? contacts.length + 1
          : contacts.length + 1,
        is_active: true,
      };

      if (editingId) {
        await userService.updateTrustedContact(editingId, payload);
      } else {
        await userService.addTrustedContact(payload);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setModalVisible(false);
      await fetchContacts(true);
    } catch (err: any) {
      haptics.error();
      toast.error(errorMessage(err, copy.safety.contactSaveFailed));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (contact: TrustedContact) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setPendingDelete(contact);
  };

  // Primary contact is the one with the lowest `priority`. The API has no
  // dedicated "set primary" route, but the update endpoint accepts `priority`,
  // so we make a contact primary by swapping its priority with the current
  // primary's. (No drag-reorder — see banner copy.)
  const handleMakePrimary = async (contact: TrustedContact) => {
    const current = contacts[0];
    if (!current || current.id === contact.id) return;
    Haptics.selectionAsync().catch(() => {});
    // Optimistic: swap the star to this contact instantly (reorder locally by
    // swapping priorities), confirm in the background, roll the list back on
    // failure. The API has no atomic "set primary" route, so the commit is a
    // two-write priority swap — if the second write fails the first is undone
    // server-side too, so priorities can never be left corrupted (which would
    // make "who is called first during SOS" indeterminate).
    const prev = contacts;
    const reordered = contacts
      .map((c) => {
        if (c.id === contact.id) return { ...c, priority: current.priority };
        if (c.id === current.id) return { ...c, priority: contact.priority };
        return c;
      })
      .sort((a, b) => a.priority - b.priority);
    await runOptimistic({
      apply: () => {
        setContacts(reordered);
        void saveCache(reordered);
      },
      rollback: () => {
        setContacts(prev);
        void saveCache(prev);
      },
      commit: async () => {
        await userService.updateTrustedContact(contact.id, {
          name: contact.name,
          phone: contact.phone,
          relationship: contact.relationship,
          priority: current.priority,
          is_active: contact.is_active,
        });
        try {
          await userService.updateTrustedContact(current.id, {
            name: current.name,
            phone: current.phone,
            relationship: current.relationship,
            priority: contact.priority,
            is_active: current.is_active,
          });
        } catch (e) {
          // Undo the first write so the two contacts can't be left sharing
          // the lowest priority, then rethrow so the UI rolls back + retries.
          await userService
            .updateTrustedContact(contact.id, {
              name: contact.name,
              phone: contact.phone,
              relationship: contact.relationship,
              priority: contact.priority,
              is_active: contact.is_active,
            })
            .catch(() => {});
          throw e;
        }
      },
      errorMessage: 'Could not update primary contact',
      retry: true,
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        void fetchContacts(true);
      },
    });
  };

  // Re-POST the removed contact's captured payload. A new id is minted,
  // but name/phone/relationship/priority are restored to server truth.
  const undoDelete = async (contact: TrustedContact) => {
    try {
      await userService.addTrustedContact({
        name: contact.name,
        phone: contact.phone,
        relationship: contact.relationship,
        priority: contact.priority,
        is_active: contact.is_active,
      });
      await fetchContacts(true);
    } catch {
      toast.error('Could not restore contact');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const removed = pendingDelete;
    const prev = contacts;
    // Optimistic: close the confirm and drop the row instantly; a failure
    // restores it (safe — a still-present contact is the fail-safe for SOS).
    setPendingDelete(null);
    await runOptimistic({
      apply: () => {
        const next = prev.filter((c) => c.id !== removed.id);
        setContacts(next);
        void saveCache(next);
      },
      rollback: () => {
        setContacts(prev);
        void saveCache(prev);
      },
      commit: () => userService.deleteTrustedContact(removed.id),
      errorMessage: copy.safety.contactRemoveFailed,
      retry: true,
      onSuccess: () => {
        toast.success(`${removed.name} removed`, {
          actionLabel: 'Undo',
          onAction: () => {
            void undoDelete(removed);
          },
        });
      },
    });
  };

  // The user's own safety data on their own device: show the full number
  // (grouped for legibility) so a fat-fingered digit can be caught before
  // an emergency — never masked.
  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('0')) {
      return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
    }
    return phone;
  };

  // Spell out the consequence when removing the primary (called first
  // during SOS) or the last remaining contact (leaves SOS with no one).
  const deleteMessage = (contact: TrustedContact) => {
    const base = `Remove ${contact.name} from your trusted contacts?`;
    if (contacts.length === 1) {
      return `${base}\n\nYou'll have no one to notify during an emergency.`;
    }
    if (contacts.findIndex((c) => c.id === contact.id) === 0) {
      const next = contacts.find((c) => c.id !== contact.id)?.name;
      return next
        ? `${base}\n\nThis is your primary SOS contact — ${next} will be called first instead.`
        : `${base}\n\nThis is your primary SOS contact.`;
    }
    return base;
  };

  const renderContact = useCallback(
    ({ item, index }: { item: TrustedContact; index: number }) => {
      const isPrimary = index === 0;
      return (
        <Card padding="md" className="flex-row items-center mx-5 mb-3">
          <View className="flex-1">
            <View className="flex-row items-center gap-2 mb-1">
              <Text
                className="flex-shrink text-sm font-montserrat-bold text-textPrimary"
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {isPrimary && (
                <View
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel="Primary contact"
                >
                  <Star
                    size={14}
                    color={LightColors.warning}
                    fill={LightColors.warning}
                  />
                </View>
              )}
              <Badge
                label={item.relationship}
                variant="soft"
                size="sm"
              />
            </View>
            <View className="flex-row items-center gap-1">
              <Phone size={12} color={LightColors.textTertiary} />
              <Text className="text-xs font-inter tabular-nums text-textSecondary">
                {formatPhone(item.phone)}
              </Text>
            </View>
          </View>

          <View className="flex-row gap-3">
            {!isPrimary && (
              <Pressable
                onPress={() => handleMakePrimary(item)}
                hitSlop={8}
                className="w-8 h-8 rounded-full bg-warningSoft items-center justify-center"
                accessibilityRole="button"
                accessibilityLabel={`Make ${item.name} the primary contact`}
              >
                <Star size={14} color={LightColors.warningDark} />
              </Pressable>
            )}
            <Pressable
              onPress={() => openEditModal(item)}
              hitSlop={8}
              className="w-8 h-8 rounded-full bg-primaryLight items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel={`Edit ${item.name}`}
            >
              <Pencil size={14} color={LightColors.primary} />
            </Pressable>
            <Pressable
              onPress={() => handleDelete(item)}
              hitSlop={8}
              className="w-8 h-8 rounded-full bg-dangerSoft items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name}`}
            >
              <Trash2 size={14} color={LightColors.danger} />
            </Pressable>
          </View>
        </Card>
      );
    },
    [contacts],
  );

  if (loading) {
    return (
      <View className="flex-1 bg-background">
        <GradientHeader
          title="Trusted Contacts"
          showBack
          fallbackHref="/(customer)/(tabs)/profile"
        />
        <ContactsSkeleton />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Trusted Contacts"
        showBack
        fallbackHref="/(customer)/(tabs)/profile"
        trailing={
          <Text className="text-xs font-inter tabular-nums text-textSecondary">
            {contacts.length}/{MAX_CONTACTS}
          </Text>
        }
      />

      {/* Safety hero */}
      <View className="items-center pt-4 pb-1">
        <Illustration name="3d-shield" size={72} />
      </View>

      {/* Info banner */}
      <View className="flex-row items-start gap-2 mx-5 mb-4 p-3 bg-primaryLight rounded-xl">
        <Star
          size={14}
          color={LightColors.warning}
          fill={LightColors.warning}
          style={{ marginTop: 2 }}
        />
        <Text className="flex-1 text-xs font-montserrat text-primary">
          The contact marked with a star is called first during SOS emergencies. Tap the star on any contact to make it primary.
        </Text>
      </View>

      <FlatList
        data={contacts}
        keyExtractor={(item) => item.id}
        renderItem={renderContact}
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          loadError ? (
            <ErrorState
              title="Couldn't load your contacts"
              onRetry={() => {
                void fetchContacts(false);
              }}
            />
          ) : (
            <EmptyState
              illustration={<Illustration name="empty-contacts" size={180} />}
              title="No trusted contacts"
              description="Add people you trust to be notified during emergencies"
            />
          )
        }
        contentContainerStyle={{
          // Clear the sticky Add bar (~16 pad + 52 button + bottom inset)
          // on every device so the last contact isn't hidden under it.
          paddingBottom: insets.bottom + 96,
          flexGrow: contacts.length === 0 ? 1 : undefined,
        }}
      />

      {/* Add button */}
      <BottomActionBar>
        <Button
          title="Add Contact"
          onPress={openAddModal}
          disabled={contacts.length >= MAX_CONTACTS}
          fullWidth
        />
      </BottomActionBar>

      {/* Add/Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            className="flex-1 bg-black/50 justify-end"
            onPress={() => setModalVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <View
              // White panel (not bg-background): the muted-fill inputs
              // (#F4F6F8) are nearly invisible against the #F7F8FA canvas,
              // so the form sheet presents them on white for a legible
              // field boundary — matching EditProfileModal.
              className="bg-surface rounded-t-3xl overflow-hidden px-5 pt-6"
              style={{ maxHeight: '92%' }}
              // Absorb touches so tapping inside the sheet doesn't fall
              // through to the scrim's dismiss handler.
              onStartShouldSetResponder={() => true}
              accessibilityViewIsModal
              onAccessibilityEscape={() => setModalVisible(false)}
            >
              <View className="flex-row items-center justify-between mb-6">
                <Text className="text-lg font-montserrat-bold text-textPrimary">
                  {editingId ? 'Edit Contact' : 'Add Contact'}
                </Text>
                <Pressable
                  onPress={() => setModalVisible(false)}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <X size={24} color={LightColors.textTertiary} />
                </Pressable>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
              >
                {Contacts && (
                  <Pressable
                    onPress={handleImportFromContacts}
                    className="flex-row items-center justify-center gap-2 py-3 mb-4 rounded-xl border border-primary bg-primaryLight"
                    accessibilityRole="button"
                    accessibilityLabel="Import from contacts"
                  >
                    <Users size={16} color={LightColors.primary} />
                    <Text className="text-sm font-montserrat-bold text-primary">
                      Import from contacts
                    </Text>
                  </Pressable>
                )}
                <Input
                  ref={nameRef}
                  label="Name"
                  value={formName}
                  onChangeText={handleNameChange}
                  placeholder="Contact name"
                  error={nameError}
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                  onSubmitEditing={() => phoneRef.current?.focus()}
                />
                <Input
                  ref={phoneRef}
                  label="Phone Number"
                  value={formPhone}
                  onChangeText={handlePhoneChange}
                  placeholder="+63 9XX XXX XXXX"
                  helperText="Philippine mobile, e.g. 09XX XXX XXXX"
                  error={phoneError}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  returnKeyType="done"
                />

                <Text className="text-sm font-montserrat-semi text-textSecondary mb-2 ml-0.5">
                  Relationship
                </Text>
                <View className="flex-row flex-wrap gap-2 mb-6">
                  {RELATIONSHIPS.map((rel) => {
                    const selected = formRelationship === rel;
                    return (
                      <Pressable
                        key={rel}
                        className={`px-4 rounded-full border ${
                          selected
                            ? 'bg-primary border-primary'
                            : 'bg-surface border-divider'
                        }`}
                        style={({ pressed }) => [
                          { minHeight: 44, justifyContent: 'center' },
                          pressed && { opacity: 0.85 },
                        ]}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setFormRelationship(rel);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Relationship: ${rel}`}
                        accessibilityState={{ selected }}
                      >
                        <Text
                          className={`text-sm font-montserrat ${
                            selected ? 'text-white' : 'text-textPrimary'
                          }`}
                        >
                          {rel}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Button
                  title={editingId ? 'Save Changes' : 'Add Contact'}
                  onPress={handleSave}
                  loading={saving}
                  loadingTitle="Saving…"
                  fullWidth
                />
              </ScrollView>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmModal
        visible={!!pendingDelete}
        title="Remove contact?"
        message={pendingDelete ? deleteMessage(pendingDelete) : ''}
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
}
