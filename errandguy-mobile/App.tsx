import './global.css';
import { StatusBar } from 'expo-status-bar';
import { View, Text } from 'react-native';

export default function App() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="font-montserrat text-text-primary text-lg">
        ErrandGuy
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}
