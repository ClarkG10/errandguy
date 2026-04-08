import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, TextInput, Alert, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Wallet, CreditCard, Smartphone } from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { useRunnerStore } from '../../../stores/runnerStore';
import { runnerService } from '../../../services/runner.service';
import { formatCurrency } from '../../../utils/formatCurrency';

export default function PayoutScreen() {
  const router = useRouter();
  const { runnerProfile, setRunnerProfile } = useRunnerStore();

  const [refreshing, setRefreshing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [bankName, setBankName] = useState(runnerProfile?.bank_name ?? '');
  const [bankAccount, setBankAccount] = useState(runnerProfile?.bank_account_number ?? '');
  const [ewalletNumber, setEwalletNumber] = useState(runnerProfile?.ewallet_number ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (runnerProfile) {
      setBankName(runnerProfile.bank_name ?? '');
      setBankAccount(runnerProfile.bank_account_number ?? '');
      setEwalletNumber(runnerProfile.ewallet_number ?? '');
    }
  }, [runnerProfile]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await runnerService.getRunnerProfile();
      setRunnerProfile(res.data.data);
    } catch {}
    setRefreshing(false);
  }, []);

  const handleSavePayoutInfo = async () => {
    setSaving(true);
    try {
      await runnerService.updateRunnerProfile({
        bank_name: bankName || undefined,
        bank_account_number: bankAccount || undefined,
      });
      Alert.alert('Success', 'Payout information updated');
      await onRefresh();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestPayout = async () => {
    Alert.alert('Request Payout', 'Are you sure you want to request a payout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Request',
        onPress: async () => {
          setRequesting(true);
          try {
            await runnerService.requestPayout(balance);
            Alert.alert('Success', 'Payout request submitted');
            await onRefresh();
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.message ?? 'Failed to request payout');
          } finally {
            setRequesting(false);
          }
        },
      },
    ]);
  };

  const balance = runnerProfile?.total_earnings ?? 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4">
        <Pressable onPress={() => router.back()}>
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary">Payouts</Text>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Balance Card */}
        <View className="px-5 mb-4">
          <Card className="p-6 items-center bg-primaryLight">
            <Wallet size={28} color="#2563EB" />
            <Text className="text-3xl font-montserrat-bold text-textPrimary mt-2">
              {formatCurrency(balance)}
            </Text>
            <Text className="text-sm font-montserrat text-textSecondary mt-1">
              Available for payout
            </Text>
          </Card>
        </View>

        {/* Request Payout */}
        <View className="px-5 mb-6">
          <Button
            title="Request Payout"
            onPress={handleRequestPayout}
            loading={requesting}
            disabled={balance <= 0}
            fullWidth
          />
        </View>

        {/* Bank Account */}
        <View className="px-5 mb-4">
          <View className="flex-row items-center gap-2 mb-2">
            <CreditCard size={16} color="#475569" />
            <Text className="text-sm font-montserrat-bold text-textSecondary">
              Bank Account
            </Text>
          </View>
          <Card className="p-4">
            <Text className="text-xs font-montserrat text-textSecondary mb-1">Bank Name</Text>
            <TextInput
              className="bg-surface border border-divider rounded-xl px-3 py-2.5 text-sm font-montserrat text-textPrimary mb-3"
              placeholder="e.g. BDO, BPI, Metrobank"
              placeholderTextColor="#94A3B8"
              value={bankName}
              onChangeText={setBankName}
            />
            <Text className="text-xs font-montserrat text-textSecondary mb-1">Account Number</Text>
            <TextInput
              className="bg-surface border border-divider rounded-xl px-3 py-2.5 text-sm font-montserrat text-textPrimary"
              placeholder="Enter account number"
              placeholderTextColor="#94A3B8"
              value={bankAccount}
              onChangeText={setBankAccount}
              keyboardType="number-pad"
            />
          </Card>
        </View>

        {/* E-Wallet */}
        <View className="px-5 mb-4">
          <View className="flex-row items-center gap-2 mb-2">
            <Smartphone size={16} color="#475569" />
            <Text className="text-sm font-montserrat-bold text-textSecondary">
              E-Wallet
            </Text>
          </View>
          <Card className="p-4">
            <Text className="text-xs font-montserrat text-textSecondary mb-1">E-Wallet Number</Text>
            <TextInput
              className="bg-surface border border-divider rounded-xl px-3 py-2.5 text-sm font-montserrat text-textPrimary"
              placeholder="e.g. GCash, Maya number"
              placeholderTextColor="#94A3B8"
              value={ewalletNumber}
              onChangeText={setEwalletNumber}
              keyboardType="phone-pad"
            />
          </Card>
        </View>

        {/* Save */}
        <View className="px-5">
          <Button
            title="Save Payout Info"
            variant="outline"
            onPress={handleSavePayoutInfo}
            loading={saving}
            fullWidth
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
