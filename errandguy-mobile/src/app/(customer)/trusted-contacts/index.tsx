import React, { useCallback, useEffect, useState } from 'react';
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
  GripVertical,
  X,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { userService } from '../../../services/user.service';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Input } from '../../../components/ui/Input';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ContactIllustration } from '../../../components/auth/OnboardingIllustrations';
import { ContactsSkeleton } from '../../../components/ui/Skeleton';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { LightColors } from '../../../constants/colors';
import type { TrustedContact } from '../../../types';
import { toast } from '../../../stores/toastStore';

const RELATIONSHIPS = ['Parent', 'Spouse', 'Sibling', 'Friend', 'Other'];
const MAX_CONTACTS = 5;
const CACHE_KEY = '@trusted_contacts_cache';

export default function TrustedContactsScreen() {
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formRelationship, setFormRelationship] = useState('Friend');
  const [pendingDelete, setPendingDelete] = useState<TrustedContact | null>(null);
  const [deletingContact, setDeletingContact] = useState(false);

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
      await saveCache(sorted);
    } catch {
      // Handle error
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

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
    setModalVisible(true);
  };

  const openEditModal = (contact: TrustedContact) => {
    setEditingId(contact.id);
    setFormName(contact.name);
    setFormPhone(contact.phone);
    setFormRelationship(contact.relationship);
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formPhone.trim()) {
      toast.error('Name and phone are required');
      return;
    }

    // Normalize phone to Philippine format (09XXXXXXXXX)
    let phone = formPhone.trim().replace(/\s+/g, '');
    if (phone.startsWith('+63')) {
      phone = '0' + phone.slice(3);
    } else if (phone.startsWith('63')) {
      phone = '0' + phone.slice(2);
    } else if (!phone.startsWith('0') && phone.startsWith('9')) {
      phone = '0' + phone;
    }

    if (!/^(0)9\d{9}$/.test(phone)) {
      toast.error('Please enter a valid Philippine phone number (e.g., 09XXXXXXXXX)');
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
      setModalVisible(false);
      await fetchContacts(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (contact: TrustedContact) => {
    setPendingDelete(contact);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeletingContact(true);
    try {
      await userService.deleteTrustedContact(pendingDelete.id);
      await fetchContacts(true);
      setPendingDelete(null);
    } catch {
      toast.error('Failed to remove contact');
    } finally {
      setDeletingContact(false);
    }
  };

  const maskPhone = (phone: string) => {
    if (phone.length <= 4) return phone;
    return phone.slice(0, 4) + '****' + phone.slice(-2);
  };

  const renderContact = useCallback(
    ({ item, index }: { item: TrustedContact; index: number }) => {
      const isPrimary = index === 0;
      return (
        <View className="flex-row items-center bg-surface rounded-xl mx-5 mb-3 p-4 border border-divider">
          {/* Drag handle placeholder */}
          <View className="mr-3">
            <GripVertical size={18} color={LightColors.textMuted} />
          </View>

          <View className="flex-1">
            <View className="flex-row items-center gap-2 mb-1">
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                {item.name}
              </Text>
              {isPrimary && (
                <Star
                  size={14}
                  color={LightColors.warning}
                  fill={LightColors.warning}
                />
              )}
              <Badge
                label={item.relationship}
                variant="primary"
                size="sm"
              />
            </View>
            <View className="flex-row items-center gap-1">
              <Phone size={12} color={LightColors.textTertiary} />
              <Text className="text-xs font-montserrat text-textSecondary">
                {maskPhone(item.phone)}
              </Text>
            </View>
          </View>

          <View className="flex-row gap-2">
            <Pressable
              onPress={() => openEditModal(item)}
              className="w-8 h-8 rounded-full bg-primaryLight items-center justify-center"
            >
              <Pencil size={14} color={LightColors.primary} />
            </Pressable>
            <Pressable
              onPress={() => handleDelete(item)}
              className="w-8 h-8 rounded-full bg-dangerSoft items-center justify-center"
            >
              <Trash2 size={14} color={LightColors.danger} />
            </Pressable>
          </View>
        </View>
      );
    },
    [contacts],
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <ContactsSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Trusted Contacts"
        showBack
        fallbackHref="/(customer)/(tabs)/profile"
        trailing={
          <Text className="text-xs font-montserrat text-textSecondary">
            {contacts.length}/{MAX_CONTACTS}
          </Text>
        }
      />

      {/* Info banner */}
      <View className="mx-5 mb-4 p-3 bg-primaryLight rounded-xl">
        <Text className="text-xs font-montserrat text-primary">
          Primary contact (⭐) is called first during SOS emergencies. Drag to reorder priority.
        </Text>
      </View>

      <FlatList
        data={contacts}
        keyExtractor={(item) => item.id}
        renderItem={renderContact}
        ListEmptyComponent={
          <EmptyState
            illustration={<ContactIllustration size={180} />}
            title="No trusted contacts"
            description="Add people you trust to be notified during emergencies"
          />
        }
        contentContainerStyle={{ paddingBottom: 100 }}
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
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-background px-7 pt-7 pb-12" style={{ maxHeight: '92%' }}>
              <View className="flex-row items-center justify-between mb-6">
                <Text className="text-lg font-montserrat-bold text-textPrimary">
                  {editingId ? 'Edit Contact' : 'Add Contact'}
                </Text>
                <Pressable onPress={() => setModalVisible(false)} hitSlop={12}>
                  <X size={24} color={LightColors.textTertiary} />
                </Pressable>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 24 }}
              >
                <Input
                  label="Name"
                  value={formName}
                  onChangeText={setFormName}
                  placeholder="Contact name"
                />
                <View className="h-3" />
                <Input
                  label="Phone Number"
                  value={formPhone}
                  onChangeText={setFormPhone}
                  placeholder="+63 9XX XXX XXXX"
                  keyboardType="phone-pad"
                />
                <View className="h-3" />

                <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
                  Relationship
                </Text>
                <View className="flex-row flex-wrap gap-2 mb-6">
                  {RELATIONSHIPS.map((rel) => (
                    <Pressable
                      key={rel}
                      className={`px-4 py-2 rounded-full border ${
                        formRelationship === rel
                          ? 'bg-primary border-primary'
                          : 'bg-surface border-divider'
                      }`}
                      onPress={() => setFormRelationship(rel)}
                    >
                      <Text
                        className={`text-sm font-montserrat ${
                          formRelationship === rel ? 'text-white' : 'text-textPrimary'
                        }`}
                      >
                        {rel}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Button
                  title={editingId ? 'Save Changes' : 'Add Contact'}
                  onPress={handleSave}
                  loading={saving}
                  fullWidth
                />
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmModal
        visible={!!pendingDelete}
        title="Remove contact?"
        message={pendingDelete ? `Remove ${pendingDelete.name} from your trusted contacts?` : ''}
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        loading={deletingContact}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
}
