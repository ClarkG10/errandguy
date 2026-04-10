import { Redirect } from 'expo-router';
import { useAuthStore } from '../stores/authStore';

export default function Index() {
  const { isAuthenticated, role } = useAuthStore();

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/welcome" />;
  }

  if (role === 'runner') {
    return <Redirect href="/(runner)/(tabs)" />;
  }

  return <Redirect href="/(customer)/(tabs)" />;
}
