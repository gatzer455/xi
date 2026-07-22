// Tauri APIs no existen en jsdom
process.on('unhandledRejection', () => {});
