import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, 'icons');

// This script uses sharp library to resize your brain icon
// If sharp is not installed, install it with: npm install sharp

async function generateIcons() {
    try {
        // Try to import sharp - install if needed
        let sharp;
        try {
            sharp = (await import('sharp')).default;
        } catch (error) {
            console.error('❌ ERROR: sharp library not found!');
            console.log('\n📦 Install sharp library with:');
            console.log('   npm install sharp\n');
            console.log('Or use yarn:');
            console.log('   yarn add sharp\n');
            process.exit(1);
        }

        // Ensure icons directory exists
        await fs.mkdir(iconsDir, { recursive: true });

        // Path to the brain icon (should be in icons folder or root)
        // Looking for icon source file
        const possiblePaths = [
            path.join(iconsDir, 'brain-icon.png'),
            path.join(iconsDir, 'brain-icon.svg'),
            path.join(__dirname, 'brain-icon.png'),
            path.join(__dirname, 'brain-icon.svg')
        ];

        let iconPath = null;
        for (const p of possiblePaths) {
            try {
                await fs.access(p);
                iconPath = p;
                console.log(`✓ Found icon at: ${p}`);
                break;
            } catch (e) {
                // Continue to next path
            }
        }

        if (!iconPath) {
            console.error('❌ Brain icon not found!');
            console.log('\n📝 Instructions:');
            console.log('1. Place your brain-icon.png or brain-icon.svg in the icons/ folder');
            console.log('2. Run this script again\n');
            process.exit(1);
        }

        console.log('\n🧠 Generating PWA icons from brain icon...\n');

        // Generate 192x192 icon
        console.log('📱 Creating 192x192 icon...');
        await sharp(iconPath)
            .resize(192, 192, {
                fit: 'contain',
                background: { r: 247, g: 244, b: 237, alpha: 1 } // App background color
            })
            .png({ quality: 90 })
            .toFile(path.join(iconsDir, 'icon-192x192.png'));
        console.log('✅ Created icon-192x192.png');

        // Generate 512x512 icon
        console.log('🎨 Creating 512x512 icon...');
        await sharp(iconPath)
            .resize(512, 512, {
                fit: 'contain',
                background: { r: 247, g: 244, b: 237, alpha: 1 } // App background color
            })
            .png({ quality: 95 })
            .toFile(path.join(iconsDir, 'icon-512x512.png'));
        console.log('✅ Created icon-512x512.png');

        // Optionally create maskable versions (for adaptive icons on Android)
        console.log('🎭 Creating maskable versions...');
        await sharp(iconPath)
            .resize(192, 192, {
                fit: 'contain',
                background: { r: 185, g: 85, b: 59, alpha: 0 } // Transparent, theme color border added by browser
            })
            .png({ quality: 90 })
            .toFile(path.join(iconsDir, 'icon-192x192-maskable.png'));
        console.log('✅ Created icon-192x192-maskable.png');

        await sharp(iconPath)
            .resize(512, 512, {
                fit: 'contain',
                background: { r: 185, g: 85, b: 59, alpha: 0 }
            })
            .png({ quality: 95 })
            .toFile(path.join(iconsDir, 'icon-512x512-maskable.png'));
        console.log('✅ Created icon-512x512-maskable.png');

        console.log('\n✨ All icons generated successfully!');
        console.log('\n📁 Icons created:');
        console.log('  - icons/icon-192x192.png (192x192 with background)');
        console.log('  - icons/icon-512x512.png (512x512 with background)');
        console.log('  - icons/icon-192x192-maskable.png (maskable for Android)');
        console.log('  - icons/icon-512x512-maskable.png (maskable for Android)');

    } catch (error) {
        console.error('❌ Error generating icons:', error.message);
        process.exit(1);
    }
}

generateIcons();
