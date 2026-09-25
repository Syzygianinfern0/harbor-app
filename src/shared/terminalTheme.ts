// Shared by xterm and tmux's default-color responses to terminal applications.
export const terminalColors = { foreground: '#dce1eb', background: '#101217' } as const;
// Find-bar highlights (the search addon needs #RRGGBB): dim amber for every match, Harbor mint for the current one.
export const terminalSearchColors = { matchBackground: '#4a4024', matchBorder: '#8a7440', matchOverviewRuler: '#e4ca88', activeMatchBackground: '#1f5a48', activeMatchBorder: '#8ce0bf', activeMatchColorOverviewRuler: '#8ce0bf' } as const;
