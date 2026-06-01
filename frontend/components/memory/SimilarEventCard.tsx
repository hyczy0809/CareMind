import { StyleSheet, Text, View } from "react-native";
import { History } from "lucide-react-native";
import { Card } from "../ui/Card";
import { colors, typography } from "../../lib/theme";

interface SimilarEventCardProps {
  date: string;
  title: string;
  description: string;
}

export function SimilarEventCard({ date, title, description }: SimilarEventCardProps) {
  return (
    <Card>
      <View style={styles.headerRow}>
        <History color={colors.status.info} size={20} />
        <Text style={styles.kicker}>和之前一次记录相似</Text>
      </View>
      <Text style={styles.title}>{date} · {title}</Text>
      <Text style={styles.body}>{description}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  kicker: {
    ...typography.label,
    color: colors.status.info
  },
  title: {
    ...typography.cardTitle,
    color: colors.text.primary,
    marginTop: 10
  },
  body: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 8
  }
});
