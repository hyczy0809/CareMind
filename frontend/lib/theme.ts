export const colors = {
  brand: {
    primary: "#1F9D74",
    primaryDark: "#0F6F55",
    primarySoft: "#DDF4EA"
  },
  surface: {
    app: "#F7F4EE",
    card: "#FFFFFF",
    muted: "#F1EFE8",
    elevated: "#FFFFFF"
  },
  text: {
    primary: "#1F2933",
    secondary: "#52616B",
    muted: "#7B8794",
    inverse: "#FFFFFF"
  },
  status: {
    calm: "#1F9D74",
    watch: "#D97706",
    alert: "#D95C45",
    info: "#3478A7"
  },
  statusSoft: {
    calm: "#DDF4EA",
    watch: "#FFF3D6",
    alert: "#FDE7E1",
    info: "#E3F2FD"
  },
  border: {
    subtle: "#E4E0D8",
    strong: "#C9C2B8"
  }
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 22,
  xxl: 28
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
    shadowColor: "#2D2A26",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 2
  },
  sheet: {
    shadowColor: "#2D2A26",
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8
  }
} as const;

export const typography = {
  pageTitle: {
    fontSize: 24,
    lineHeight: 32,
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
