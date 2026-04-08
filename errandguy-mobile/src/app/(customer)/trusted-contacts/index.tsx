import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  Alert,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  UserPlus,
  Star,
  Pencil,
  Trash2,
  Phone,
  GripVertical,
  X,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { userService } from '../../../services/user.service';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';
import type { TrustedContact } from '../../../types';

const RELATIONSHIPS = ['Parent', 'Spouse', 'Sibling', 'Friend', 'Other'];
const MAX_CONTACTS = 5;

export default function TrustedContactsScreen() {
  const router = useRouter();
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formRelationship, setFormRelationship] = useState('Friend');

  const fetchContacts = useCallback(async () => {
    try {
      const res = await userService.getTrustedContacts();
      const data = res.data.data ?? res.data ?? [];
      setContacts(Array.isArray(data) ? data.sort((a: TrustedContact, b: TrustedContact) => a.priority - b.priority) : []);
    } catch {
      // Handle error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const openAddModal = () => {
    if (contacts.length >= MAX_CONTACTS) {
      Alert.alert('Limit Reached', `You can only add up to ${MAX_CONTACTS} trusted contacts.`);
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
      Alert.alert('Error', 'Name and phone are required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        phone: formPhone.trim(),
        relationship: formRelationship,
        priority: editingId
          ? contacts.find((c) => c.id === editingId)?.priority ?? contacts.length + 1
          : contacts.length + 1,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        await userService.updateTrustedContact(editingId, payload);
      } else {
        await userService.addTrustedContact(payload);
      }
      setModalVisible(false);
      await fetchContacts();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (contact: TrustedContact) => {
    Alert.alert(
      'Remove Contact',
      `Remove ${contact.name} from your trusted contacts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await userService.deleteTrustedContact(contact.id);
              await fetchContacts();
            } catch {
              Alert.alert('Error', 'Failed to remove contact');
            }
          },
        },
      ],
    );
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
            <GripVertical size={18} color="#94A3B8" />
          </View>

          <View className="flex-1">
            <View className="flex-row items-center gap-2 mb-1">
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                {item.name}
              </Text>
              {isPrimary && (
                <Star size={14} color="#F59E0B" fill="#F59E0B" />
              )}
              <Badge
                label={item.relationship}
                variant="primary"
                size="sm"
              />
            </View>
            <View className="flex-row items-center gap-1">
              <Phone size={12} color="#64748B" />
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
              <Pencil size={14} color="#2563EB" />
            </Pressable>
            <Pressable
              onPress={() => handleDelete(item)}
              className="w-8 h-8 rounded-full bg-red-50 items-center justify-center"
            >
              <Trash2 size={14} color="#EF4444" />
            </Pressable>
          </View>
        </View>
      );
    },
    [contacts],
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center" edges={['top']}>
        <ActivityIndicator size="large" color="#2563EB" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4">
        <View className="flex-row items-center">
          <Pressable onPress={() => router.back()} className="mr-3">
            <ArrowLeft size={24} color="#0F172A" />
          </Pressable>
          <Text className="text-xl font-montserrat-bold text-textPrimary">
            Trusted Contacts
          </Text>
        </View>
        <Text className="text-xs font-montserrat text-textSecondary">
          {contacts.length}/{MAX_CONTACTS}
        </Text>
      </View>

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
            icon={UserPlus}
            title="No trusted contacts"
            description="Add people you trust to be notified during emergencies"
          />
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      />

      {/* Add button */}
      <View className="absolute bottom-0 left-0 right-0 bg-background border-t border-divider px-5 py-4 pb-8">
        <Button
          title="Add Contact"
          onPress={openAddModal}
          disabled={contacts.length >= MAX_CONTACTS}
          fullWidth
        />
      </View>

      {/* Add/Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-background rounded-t-3xl px-5 pt-6 pb-10">
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-lg font-montserrat-bold text-textPrimary">
                {editingId ? 'Edit Contact' : 'Add Contact'}
              </Text>
              <Pressable onPress={() => setModalVisible(false)}>
                <X size={24} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
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
      </Modal>
    </SafeAreaView>
  );
}
