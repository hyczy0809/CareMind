export const colors = {
  brand: {
    primary: "#238663",
    primaryDark: "#245847",
    primarySoft: "#E8F3E8",
    warm: "#D98253",
    warmSoft: "#FFF1E5"
  },
  surface: {
    app: "#FAF5EC",
    wash: "#F4EFE5",
    card: "#FFFDF8",
    muted: "#F2ECE2",
    elevated: "#FFFFFF",
    info: "#FFF1E5",
    brand: "#F1F8F1",
    watch: "#FFF5DC",
    alert: "#FFF0EA"
  },
  text: {
    primary: "#2B241D",
    secondary: "#655A4F",
    muted: "#8A7F73",
    inverse: "#FFFFFF"
  },
  status: {
    calm: "#238663",
    watch: "#B56A18",
    alert: "#C8503B",
    info: "#476F92"
  },
  statusSoft: {
    calm: "#E8F3E8",
    watch: "#FFF5DC",
    alert: "#FFF0EA",
    info: "#EAF1F6"
  },
  border: {
    subtle: "#E7DCCF",
    strong: "#D2BFAE"
  }
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  xxl: 18,
  pill: 999
} as const;

export const spacing = {
  page: 16,
  card: 16,
  gap: 12,
  section: 20
} as const;

export const hitSlop = {
  top: 10,
  right: 10,
  bottom: 10,
  left: 10
};

export const shadow = {
  card: {
    shadowColor: "#7A5B42",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
    elevation: 2
  },
  soft: {
    shadowColor: "#7A5B42",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1
  },
  sheet: {
    shadowColor: "#4E3929",
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.13,
    shadowRadius: 24,
    elevation: 8
  }
} as const;

export const typography = {
  pageTitle: {
    fontSize: 25,
    lineHeight: 33,
    fontWeight: "700" as const
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "700" as const
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const
  },
  helper: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "400" as const
  },
  label: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700" as const
  },
  small: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "400" as const
  }
} as const;
