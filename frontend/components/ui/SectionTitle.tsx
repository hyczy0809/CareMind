import { StyleSheet, Text, View } from "react-native";
import { colors, typography } from "../../lib/theme";

interface SectionTitleProps {
  title: string;
  helper?: string;
}

export function SectionTitle({ title, helper }: SectionTitleProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    marginBottom: 8
  },
  title: {
    ...typography.label,
    color: colors.text.primary
  },
  helper: {
    ...typography.small,
    color: colors.text.muted,
    marginTop: 2
  }
});
