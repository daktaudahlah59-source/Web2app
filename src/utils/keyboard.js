/**
 * Generate inline keyboards for bot
 */

// Main menu keyboard
function getMainKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '📱 BUAT APLIKASI (URL)', callback_data: 'create_apk' },
                { text: '📦 BUILD PROJECT (ZIP)', callback_data: 'build_zip' }
            ],
            [
                { text: '📋 Cek Antrian', callback_data: 'check_queue' },
                { text: '📜 Menu Perintah', callback_data: 'show_commands' },
                { text: '❓ Bantuan', callback_data: 'help' }
            ],
            [
                { text: '👤 Owner', url: 'https://t.me/ItsNixcaL' },
                { text: '🙏 TQTO', callback_data: 'thanks_to' },
                { text: '📢 Channel', url: 'https://t.me/NixcalCh' }
            ]
        ]
    };
}

// Color selection keyboard
function getColorKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🔵 Biru', callback_data: 'color_blue' }, { text: '🔴 Merah', callback_data: 'color_red' }, { text: '🟢 Hijau', callback_data: 'color_green' }],
            [{ text: '🟣 Ungu', callback_data: 'color_purple' }, { text: '🟠 Oranye', callback_data: 'color_orange' }, { text: '🔵 Teal', callback_data: 'color_teal' }],
            [{ text: '💗 Pink', callback_data: 'color_pink' }, { text: '🔵 Indigo', callback_data: 'color_indigo' }],
            [{ text: '❌ Batal', callback_data: 'cancel' }]
        ]
    };
}

// Confirmation keyboard
function getConfirmKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '✅ Buat APK', callback_data: 'confirm_build' }],
            [{ text: '❌ Batal', callback_data: 'cancel' }]
        ]
    };
}

// Cancel keyboard
function getCancelKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '❌ Batal', callback_data: 'cancel' }]
        ]
    };
}

// Icon upload keyboard
function getIconKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '⏭️ Lewati (Gunakan Default)', callback_data: 'skip_icon' }],
            [{ text: '❌ Batal', callback_data: 'cancel' }]
        ]
    };
}

// ZIP project type keyboard
function getZipTypeKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🤖 Android Studio / Gradle', callback_data: 'zip_android' }, { text: '💙 Flutter Project', callback_data: 'zip_flutter' }],
            [{ text: '❌ Batal', callback_data: 'cancel' }]
        ]
    };
}

// ZIP build type keyboard (debug/release)
function getZipBuildTypeKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🐛 Debug APK (Fast)', callback_data: 'zipbuild_debug' }, { text: '🚀 Release APK', callback_data: 'zipbuild_release' }],
            [{ text: '❌ Batal', callback_data: 'cancel' }]
        ]
    };
}

module.exports = {
    getMainKeyboard,
    getColorKeyboard,
    getConfirmKeyboard,
    getCancelKeyboard,
    getIconKeyboard,
    getZipTypeKeyboard,
    getZipBuildTypeKeyboard
};
