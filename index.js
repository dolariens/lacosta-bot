const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, ChannelType, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const activeTickets = new Map();
const paymentSessions = new Map();
const paymentMonitors = new Map();
const genCooldowns = new Map();
const freeGenCooldowns = new Map();
const activeGiveaways = new Map();

const ADMIN_USER_IDS = ['1436220760304652338', '1482300597935013968'];
const REQUIRED_STATUS = '.gg/lacostagen';

let stockMessageId = null;
if (fs.existsSync('./stock_message.json')) {
    try {
        const data = JSON.parse(fs.readFileSync('./stock_message.json', 'utf8'));
        stockMessageId = data.messageId;
    } catch (error) {
        console.error('Error loading stock message ID:', error);
    }
}

function saveStockMessageId(messageId) {
    stockMessageId = messageId;
    fs.writeFileSync('./stock_message.json', JSON.stringify({ messageId: messageId }));
}

let keysData = { keys: [], subscriptions: [] };
if (fs.existsSync('./keys.json')) {
    try {
        keysData = JSON.parse(fs.readFileSync('./keys.json', 'utf8'));
        if (!keysData.keys) keysData.keys = [];
        if (!keysData.subscriptions) keysData.subscriptions = [];
    } catch (error) {
        console.error('Error loading keys.json:', error);
        keysData = { keys: [], subscriptions: [] };
    }
}

let whitelistedUsers = { users: [] };
if (fs.existsSync('./whitelist.json')) {
    try {
        whitelistedUsers = JSON.parse(fs.readFileSync('./whitelist.json', 'utf8'));
        if (!whitelistedUsers.users) whitelistedUsers.users = [];
    } catch (error) {
        console.error('Error loading whitelist.json:', error);
        whitelistedUsers = { users: [] };
    }
}

function saveKeys() {
    fs.writeFileSync('./keys.json', JSON.stringify(keysData, null, 2));
}

function saveWhitelist() {
    fs.writeFileSync('./whitelist.json', JSON.stringify(whitelistedUsers, null, 2));
}

if (!fs.existsSync('./valo.txt')) {
    fs.writeFileSync('./valo.txt', '');
}
if (!fs.existsSync('./fortnite.txt')) {
    fs.writeFileSync('./fortnite.txt', '');
}
if (!fs.existsSync('./freevalo.txt')) {
    fs.writeFileSync('./freevalo.txt', '');
}

const NOWPAYMENTS_API = 'https://api.nowpayments.io/v1';
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1506320430330544148/Umv5I4PSKSb7lvx_wy7MgTguvH57s2whP2j1GRIV9nRD8m7K0aKQerimKbzyErEd8jS8';
const GEN_COOLDOWN = 12 * 60 * 60 * 1000;
const FREE_GEN_COOLDOWN = 24 * 60 * 60 * 1000;

const commands = [
    new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('Redeem a key')
        .addStringOption(option =>
            option.setName('key')
                .setDescription('Your key')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('check')
        .setDescription('Check your remaining subscription time'),
    new SlashCommandBuilder()
        .setName('givekey')
        .setDescription('Give a key to a user (Admin only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to give the key to')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Duration of the key')
                .setRequired(true)
                .addChoices(
                    { name: '1 Hour (Test)', value: 'test' },
                    { name: '1 Day', value: '1day' },
                    { name: '1 Week', value: '1week' }
                )
        ),
    new SlashCommandBuilder()
        .setName('gen')
        .setDescription('Generate an account (Premium)')
        .addStringOption(option =>
            option.setName('game')
                .setDescription('Select game')
                .setRequired(true)
                .addChoices(
                    { name: 'Valorant', value: 'valo' },
                    { name: 'Fortnite', value: 'fortnite' }
                )
        ),
    new SlashCommandBuilder()
        .setName('freegen')
        .setDescription('Generate a free Valorant account (24h cooldown)'),
    new SlashCommandBuilder()
        .setName('stock')
        .setDescription('Check account stock'),
    new SlashCommandBuilder()
        .setName('removecooldown')
        .setDescription('Remove cooldown from a user (Admin only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to remove cooldown from')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Check if you are whitelisted'),
    new SlashCommandBuilder()
        .setName('unwhitelist')
        .setDescription('Remove whitelist from a user (Admin only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to remove whitelist from')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Create a giveaway (Admin only)')
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Key duration')
                .setRequired(true)
                .addChoices(
                    { name: '1 Hour (Test)', value: 'test' },
                    { name: '1 Day', value: '1day' },
                    { name: '1 Week', value: '1week' }
                )
        )
        .addIntegerOption(option =>
            option.setName('winners')
                .setDescription('Number of winners')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(20)
        )
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Giveaway duration (e.g., 1h, 30m, 1d)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Giveaway description')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Create a verification panel (Admin only)')
];

function checkUserStatus(member) {
    if (!member.presence || !member.presence.activities) {
        return false;
    }

    for (const activity of member.presence.activities) {
        if (activity.type === 4 && activity.state) {
            if (activity.state.toLowerCase().includes(REQUIRED_STATUS.toLowerCase())) {
                return true;
            }
        }
    }

    return false;
}

client.once('clientReady', async () => {
    console.log(`✅ Bot is online as ${client.user.tag}`);
    console.log(`📊 Active in ${client.guilds.cache.size} servers`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('🔄 Registering slash commands...');
        
        for (const guild of client.guilds.cache.values()) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: commands }
            );
        }

        console.log('✅ Slash commands registered successfully!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }

    setInterval(checkExpiredSubscriptions, 60000);
    setInterval(checkExpiredGiveaways, 10000);
    await initializeStockWebhook();
    watchStockFiles();
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!ticket')) return;

    const args = message.content.split(' ');
    const subCommand = args[1]?.toLowerCase();

    if (!subCommand || !['support', 'request', 'buy'].includes(subCommand)) {
        return message.reply('❌ Use: `!ticket support`, `!ticket request` or `!ticket buy`');
    }

    try {
        if (subCommand === 'support') {
            await createTicketPanel(message, 'support', config.supportCategoryId);
        } else if (subCommand === 'request') {
            await createTicketPanel(message, 'request', config.requestCategoryId);
        } else if (subCommand === 'buy') {
            await createTicketPanel(message, 'buy', config.buyCategoryId);
        }
    } catch (error) {
        console.error('Error creating panel:', error);
        message.reply('❌ Error creating ticket panel.');
    }
});

async function createTicketPanel(message, type, categoryId) {
    const emojis = {
        support: '🎫',
        request: '🎮',
        buy: '💰'
    };

    const titles = {
        support: 'Support Ticket System',
        request: 'Game Request System',
        buy: 'Buy Ticket System'
    };

    const descriptions = {
        support: 'Click the button below to open a support ticket.\nOur team will assist you as soon as possible.',
        request: 'Click the button below to create a game request.\nLet us know which game you want.',
        buy: 'Click the button below to open a buy ticket.\nSelect your preferred duration and receive payment information instantly.'
    };

    const embed = new EmbedBuilder()
        .setColor(type === 'support' ? '#5865F2' : type === 'request' ? '#57F287' : '#FEE75C')
        .setTitle(`${emojis[type]} ${titles[type]}`)
        .setDescription(descriptions[type])
        .setFooter({ text: `${message.guild.name} Ticket System` })
        .setTimestamp();

    const button = new ButtonBuilder()
        .setCustomId(`create_ticket_${type}`)
        .setLabel(`${emojis[type]} Open Ticket`)
        .setStyle(type === 'buy' ? ButtonStyle.Success : ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
}

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('create_ticket_')) {
                await handleTicketCreation(interaction);
            } else if (interaction.customId.startsWith('close_ticket_')) {
                await handleTicketClose(interaction);
            } else if (interaction.customId.startsWith('check_payment_')) {
                const paymentId = interaction.customId.replace('check_payment_', '');
                await checkPaymentStatus(interaction, paymentId);
            } else if (interaction.customId.startsWith('giveaway_enter_')) {
                await handleGiveawayEntry(interaction);
            } else if (interaction.customId === 'verify_button') {
                await handleVerification(interaction);
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'duration_select') {
                await handleDurationSelect(interaction);
            }
        } else if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'redeem') {
                await handleRedeemCommand(interaction);
            } else if (interaction.commandName === 'check') {
                await handleCheckCommand(interaction);
            } else if (interaction.commandName === 'givekey') {
                await handleGiveKeyCommand(interaction);
            } else if (interaction.commandName === 'gen') {
                await handleGenCommand(interaction);
            } else if (interaction.commandName === 'freegen') {
                await handleFreeGenCommand(interaction);
            } else if (interaction.commandName === 'stock') {
                await handleStockCommand(interaction);
            } else if (interaction.commandName === 'removecooldown') {
                await handleRemoveCooldownCommand(interaction);
            } else if (interaction.commandName === 'whitelist') {
                await handleWhitelistCommand(interaction);
            } else if (interaction.commandName === 'unwhitelist') {
                await handleUnwhitelistCommand(interaction);
            } else if (interaction.commandName === 'giveaway') {
                await handleGiveawayCommand(interaction);
            } else if (interaction.commandName === 'verify') {
                await handleVerifyCommand(interaction);
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        
        const errorMessage = '❌ An error occurred while processing your request.';
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: errorMessage }).catch(console.error);
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true }).catch(console.error);
        }
    }
});

async function handleGiveawayCommand(interaction) {
    const userId = interaction.user.id;
    
    if (!ADMIN_USER_IDS.includes(userId)) {
        return interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true
        });
    }

    const duration = interaction.options.getString('duration');
    const winners = interaction.options.getInteger('winners');
    const timeStr = interaction.options.getString('time');
    const description = interaction.options.getString('description') || 'React with 🎉 to enter!';

    await interaction.deferReply({ ephemeral: true });

    const timeMatch = timeStr.match(/^(\d+)([mhd])$/);
    if (!timeMatch) {
        return interaction.editReply({
            content: '❌ Invalid time format. Use format like: 1h, 30m, 1d'
        });
    }

    const timeValue = parseInt(timeMatch[1]);
    const timeUnit = timeMatch[2];
    
    let durationMs;
    switch (timeUnit) {
        case 'm':
            durationMs = timeValue * 60 * 1000;
            break;
        case 'h':
            durationMs = timeValue * 60 * 60 * 1000;
            break;
        case 'd':
            durationMs = timeValue * 24 * 60 * 60 * 1000;
            break;
    }

    const endTime = Date.now() + durationMs;
    const durationText = duration === 'test' ? '1 Hour' : duration === '1day' ? '1 Day' : '1 Week';

    const giveawayEmbed = new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle('🎉 GIVEAWAY 🎉')
        .setDescription(`${description}\n\n**Prize:** ${winners}x ${durationText} Key${winners > 1 ? 's' : ''}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>`)
        .setFooter({ text: `Hosted by ${interaction.user.tag}` })
        .setTimestamp();

    const enterButton = new ButtonBuilder()
        .setCustomId(`giveaway_enter_${Date.now()}`)
        .setLabel('🎉 Enter Giveaway')
        .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(enterButton);

    const giveawayMessage = await interaction.channel.send({ embeds: [giveawayEmbed], components: [row] });

    activeGiveaways.set(giveawayMessage.id, {
        messageId: giveawayMessage.id,
        channelId: interaction.channel.id,
        guildId: interaction.guild.id,
        hostId: interaction.user.id,
        duration: duration,
        winners: winners,
        endTime: endTime,
        entries: [],
        ended: false
    });

    await interaction.editReply({
        content: `✅ Giveaway created successfully! It will end <t:${Math.floor(endTime / 1000)}:R>`
    });
}

async function handleGiveawayEntry(interaction) {
    const messageId = interaction.message.id;
    const giveaway = activeGiveaways.get(messageId);

    if (!giveaway) {
        return interaction.reply({
            content: '❌ This giveaway is no longer active.',
            ephemeral: true
        });
    }

    if (giveaway.ended) {
        return interaction.reply({
            content: '❌ This giveaway has already ended.',
            ephemeral: true
        });
    }

    const userId = interaction.user.id;

    if (giveaway.entries.includes(userId)) {
        return interaction.reply({
            content: '❌ You have already entered this giveaway!',
            ephemeral: true
        });
    }

    giveaway.entries.push(userId);

    await interaction.reply({
        content: '✅ You have successfully entered the giveaway! Good luck! 🎉',
        ephemeral: true
    });
}

async function checkExpiredGiveaways() {
    const now = Date.now();

    for (const [messageId, giveaway] of activeGiveaways.entries()) {
        if (!giveaway.ended && now >= giveaway.endTime) {
            await endGiveaway(messageId, giveaway);
        }
    }
}

async function endGiveaway(messageId, giveaway) {
    giveaway.ended = true;

    try {
        const channel = client.channels.cache.get(giveaway.channelId);
        if (!channel) {
            activeGiveaways.delete(messageId);
            return;
        }

        const message = await channel.messages.fetch(messageId);

        if (giveaway.entries.length === 0) {
            const noWinnersEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('🎉 GIVEAWAY ENDED 🎉')
                .setDescription('No one entered the giveaway. 😢')
                .setFooter({ text: `Hosted by ${giveaway.hostId}` })
                .setTimestamp();

            await message.edit({ embeds: [noWinnersEmbed], components: [] });
            await channel.send('❌ Giveaway ended with no entries.');
            activeGiveaways.delete(messageId);
            return;
        }

        const winnersCount = Math.min(giveaway.winners, giveaway.entries.length);
        const winners = [];

        const shuffled = [...giveaway.entries].sort(() => Math.random() - 0.5);
        for (let i = 0; i < winnersCount; i++) {
            winners.push(shuffled[i]);
        }

        const durationMs = giveaway.duration === 'test' ? 3600000 : giveaway.duration === '1day' ? 86400000 : 604800000;
        const durationText = giveaway.duration === 'test' ? '1 Hour' : giveaway.duration === '1day' ? '1 Day' : '1 Week';

        for (const winnerId of winners) {
            const key = generateKey();
            const expiresAt = Date.now() + durationMs;

            keysData.keys.push({
                key: key,
                userId: winnerId,
                guildId: giveaway.guildId,
                duration: giveaway.duration,
                durationMs: durationMs,
                expiresAt: expiresAt,
                createdAt: Date.now(),
                redeemed: false,
                giveaway: true
            });

            try {
                const winner = await client.users.fetch(winnerId);
                const keyEmbed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('🎉 Congratulations! You Won!')
                    .setDescription(`You won the giveaway!\n\nHere is your key:\n\n\`\`\`${key}\`\`\`\n\nUse \`/redeem ${key}\` to redeem your key.`)
                    .addFields(
                        { name: '⏱️ Duration', value: durationText, inline: true },
                        { name: '📅 Valid until', value: `<t:${Math.floor(expiresAt / 1000)}:F>`, inline: false }
                    )
                    .setFooter({ text: 'Keep this key safe!' })
                    .setTimestamp();

                await winner.send({ embeds: [keyEmbed] });
            } catch (error) {
                console.error(`Error sending key to winner ${winnerId}:`, error);
            }
        }

        saveKeys();

        const winnerMentions = winners.map(id => `<@${id}>`).join(', ');

        const endedEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎉 GIVEAWAY ENDED 🎉')
            .setDescription(`**Winners:** ${winnerMentions}\n\n**Prize:** ${winnersCount}x ${durationText} Key${winnersCount > 1 ? 's' : ''}`)
            .setFooter({ text: `Hosted by ${giveaway.hostId}` })
            .setTimestamp();

        await message.edit({ embeds: [endedEmbed], components: [] });
        await channel.send(`🎉 Congratulations ${winnerMentions}! You won the giveaway! Check your DMs for your key!`);

        activeGiveaways.delete(messageId);

    } catch (error) {
        console.error('Error ending giveaway:', error);
        activeGiveaways.delete(messageId);
    }
}

async function handleVerifyCommand(interaction) {
    const userId = interaction.user.id;
    
    if (!ADMIN_USER_IDS.includes(userId)) {
        return interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    const verifyEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('✅ Verification')
        .setDescription('Click the button below to verify yourself and get access to the server!')
        .setFooter({ text: `${interaction.guild.name} Verification` })
        .setTimestamp();

    const verifyButton = new ButtonBuilder()
        .setCustomId('verify_button')
        .setLabel('✅ Verify')
        .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(verifyButton);

    await interaction.channel.send({ embeds: [verifyEmbed], components: [row] });

    await interaction.editReply({
        content: '✅ Verification panel created successfully!'
    });
}

async function handleVerification(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    await interaction.deferReply({ ephemeral: true });

    try {
        const member = await interaction.guild.members.fetch(userId);

        if (!config.verifiedRoleId) {
            return interaction.editReply({
                content: '❌ Verified role is not configured. Please contact an administrator.'
            });
        }

        if (member.roles.cache.has(config.verifiedRoleId)) {
            return interaction.editReply({
                content: '✅ You are already verified!'
            });
        }

        await member.roles.add(config.verifiedRoleId);

        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Verification Successful!')
            .setDescription(`You have been verified in **${interaction.guild.name}**!\n\nYou now have access to the server.`)
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        console.error('Error verifying user:', error);
        await interaction.editReply({
            content: '❌ Error verifying you. Please contact an administrator.'
        });
    }
}

async function handleTicketCreation(interaction) {
    const type = interaction.customId.replace('create_ticket_', '');
    const userId = interaction.user.id;
    const userTickets = Array.from(activeTickets.values()).filter(t => t.userId === userId && t.type === type);

    if (userTickets.length > 0) {
        return interaction.reply({ content: '❌ You already have an open ticket of this type!', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const categoryId = type === 'support' ? config.supportCategoryId : type === 'request' ? config.requestCategoryId : config.buyCategoryId;
    const category = interaction.guild.channels.cache.get(categoryId);

    if (!category) {
        return interaction.editReply({ content: '❌ Category not found! Please check config.json' });
    }

    const ticketNumber = Math.floor(Math.random() * 9000) + 1000;
    const channelName = `${config.ticketPrefix}${type}-${ticketNumber}`;

    try {
        const ticketChannel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                },
                {
                    id: client.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
                }
            ]
        });

        activeTickets.set(ticketChannel.id, {
            userId: interaction.user.id,
            type: type,
            createdAt: Date.now()
        });

        const emojis = { support: '🎫', request: '🎮', buy: '💰' };
        const colors = { support: '#5865F2', request: '#57F287', buy: '#FEE75C' };

        const welcomeEmbed = new EmbedBuilder()
            .setColor(colors[type])
            .setTitle(`${emojis[type]} ${type.charAt(0).toUpperCase() + type.slice(1)} Ticket`)
            .setDescription(`Welcome ${interaction.user}, your ticket has been created!\n\n${type === 'support' ? 'Describe your problem and our team will help you.' : type === 'request' ? 'Tell us which game you want.' : 'Select your desired duration.'}`)
            .setFooter({ text: `Ticket #${ticketNumber}` })
            .setTimestamp();

        const closeButton = new ButtonBuilder()
            .setCustomId(`close_ticket_${ticketChannel.id}`)
            .setLabel('🔒 Close Ticket')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(closeButton);

        await ticketChannel.send({ content: `${interaction.user}`, embeds: [welcomeEmbed], components: [row] });

        if (type === 'buy') {
            await handleBuyTicketAutoResponse(ticketChannel, interaction.user);
        }

        await interaction.editReply({ content: `✅ Your ticket has been created: ${ticketChannel}` });

    } catch (error) {
        console.error('Error creating ticket:', error);
        await interaction.editReply({ content: '❌ Error creating ticket.' });
    }
}

async function handleBuyTicketAutoResponse(channel, user) {
    const durationEmbed = new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle('⏱️ Select Duration')
        .setDescription('Please select your desired duration:\n\n**Test (1 Hour)** - $1.00\n**1 Day** - $5.00\n**1 Week** - $15.00')
        .setFooter({ text: 'You will receive payment information immediately after selection' })
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('duration_select')
        .setPlaceholder('Select a duration')
        .addOptions([
            {
                label: 'Test (1 Hour) - $1.00',
                description: 'Test access for 1 hour',
                value: 'test_1',
                emoji: '🧪'
            },
            {
                label: '1 Day - $5.00',
                description: 'Access for 1 day',
                value: '1day_5',
                emoji: '📅'
            },
            {
                label: '1 Week - $15.00',
                description: 'Access for 1 week',
                value: '1week_15',
                emoji: '📆'
            }
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await channel.send({ embeds: [durationEmbed], components: [row] });
}

async function handleDurationSelect(interaction) {
    const selection = interaction.values[0];
    const [duration, priceStr] = selection.split('_');
    const priceUSD = parseFloat(priceStr);

    const durationText = duration === 'test' ? '1 Hour (Test)' : duration === '1day' ? '1 Day' : '1 Week';
    const durationMs = duration === 'test' ? 3600000 : duration === '1day' ? 86400000 : 604800000;

    await interaction.deferReply();

    try {
        const priceResponse = await axios.get(`${NOWPAYMENTS_API}/estimate`, {
            params: {
                amount: priceUSD,
                currency_from: 'usd',
                currency_to: 'ltc'
            },
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY
            }
        });

        const ltcAmount = priceResponse.data.estimated_amount;

        const paymentData = {
            price_amount: priceUSD,
            price_currency: 'usd',
            pay_currency: 'ltc',
            ipn_callback_url: 'https://your-webhook-url.com/nowpayments',
            order_id: `ticket-${interaction.channel.id}-${Date.now()}`,
            order_description: `${durationText} Access - ${interaction.user.tag}`
        };

        const paymentResponse = await axios.post(`${NOWPAYMENTS_API}/payment`, paymentData, {
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const payment = paymentResponse.data;

        paymentSessions.set(interaction.channel.id, {
            paymentId: payment.payment_id,
            userId: interaction.user.id,
            amount: ltcAmount,
            currency: 'LTC',
            address: payment.pay_address,
            duration: duration,
            durationMs: durationMs,
            priceUSD: priceUSD,
            guildId: interaction.guild.id,
            createdAt: Date.now()
        });

        const paymentEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('💰 Litecoin Payment')
            .setDescription(`**Duration:** ${durationText}\n**Price:** $${priceUSD.toFixed(2)} USD\n\nPlease send **${ltcAmount} LTC** to the following address:`)
            .addFields(
                { name: '📍 Litecoin Address', value: `\`\`\`${payment.pay_address}\`\`\``, inline: false },
                { name: '💵 Amount', value: `**${ltcAmount} LTC**`, inline: true },
                { name: '💲 USD Value', value: `$${priceUSD.toFixed(2)}`, inline: true },
                { name: '⏱️ Duration', value: durationText, inline: true },
                { name: '🆔 Payment ID', value: `\`${payment.payment_id}\``, inline: false },
                { name: '📊 Status', value: '⏳ Waiting for payment...', inline: false }
            )
            .setFooter({ text: 'Payment will be verified automatically • Send exact amount' })
            .setTimestamp();

        const paymentButton = new ButtonBuilder()
            .setLabel('🔗 Open Payment in Browser')
            .setStyle(ButtonStyle.Link)
            .setURL(payment.payment_url || `https://nowpayments.io/payment/?iid=${payment.payment_id}`);

        const checkButton = new ButtonBuilder()
            .setCustomId(`check_payment_${payment.payment_id}`)
            .setLabel('🔄 Check Payment')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(paymentButton, checkButton);

        const message = await interaction.editReply({ embeds: [paymentEmbed], components: [row] });

        const confirmEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('✅ Payment Information Sent')
            .setDescription(`Payment information has been created.\n\n**Important:**\n• Send **exactly ${ltcAmount} LTC**\n• To the provided address\n• Payment will be verified automatically\n• You will receive a key via DM after confirmation`)
            .setTimestamp();

        await interaction.channel.send({ embeds: [confirmEmbed] });

        startPaymentMonitoring(payment.payment_id, interaction.channel.id, message.id);

    } catch (error) {
        console.error('Error creating payment:', error.response?.data || error.message);
        
        let errorMessage = '❌ Error creating payment.';
        
        if (error.response?.data?.message) {
            errorMessage += `\n\n**Error details:** ${error.response.data.message}`;
        }
        
        if (error.response?.status === 401) {
            errorMessage += '\n\n**Note:** NOWPayments API key is invalid or missing. Please check .env file.';
        }
        
        errorMessage += '\n\nPlease contact an administrator.';

        await interaction.editReply({ content: errorMessage });
    }
}

async function checkPaymentStatus(interaction, paymentId) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const statusResponse = await axios.get(`${NOWPAYMENTS_API}/payment/${paymentId}`, {
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY
            }
        });

        const status = statusResponse.data.payment_status;
        const statusEmojis = {
            'waiting': '⏳',
            'confirming': '🔄',
            'confirmed': '✅',
            'sending': '📤',
            'partially_paid': '⚠️',
            'finished': '✅',
            'failed': '❌',
            'refunded': '↩️',
            'expired': '⏰'
        };

        const statusTexts = {
            'waiting': 'Waiting for payment',
            'confirming': 'Payment is being confirmed',
            'confirmed': 'Payment confirmed',
            'sending': 'Payment is being processed',
            'partially_paid': 'Partially paid',
            'finished': 'Payment completed',
            'failed': 'Payment failed',
            'refunded': 'Payment refunded',
            'expired': 'Payment expired'
        };

        await interaction.editReply({
            content: `${statusEmojis[status] || '❓'} **Status:** ${statusTexts[status] || status}`
        });

        if (status === 'finished' || status === 'confirmed') {
            const sessionData = paymentSessions.get(interaction.channel.id);
            if (sessionData) {
                await processSuccessfulPayment(interaction.channel, sessionData);
            }
        }

    } catch (error) {
        console.error('Error checking payment:', error);
        await interaction.editReply({
            content: '❌ Error checking payment.'
        });
    }
}

function startPaymentMonitoring(paymentId, channelId, messageId) {
    if (paymentMonitors.has(paymentId)) {
        clearInterval(paymentMonitors.get(paymentId));
    }

    const checkInterval = setInterval(async () => {
        try {
            const statusResponse = await axios.get(`${NOWPAYMENTS_API}/payment/${paymentId}`, {
                headers: {
                    'x-api-key': process.env.NOWPAYMENTS_API_KEY
                }
            });

            const status = statusResponse.data.payment_status;

            const channel = client.channels.cache.get(channelId);
            if (channel && messageId) {
                try {
                    const message = await channel.messages.fetch(messageId);
                    const embed = message.embeds[0];
                    
                    if (embed) {
                        const statusEmojis = {
                            'waiting': '⏳ Waiting for payment...',
                            'confirming': '🔄 Confirming payment...',
                            'confirmed': '✅ Payment confirmed!',
                            'sending': '📤 Processing payment...',
                            'partially_paid': '⚠️ Partially paid',
                            'finished': '✅ Payment completed!',
                            'failed': '❌ Payment failed',
                            'refunded': '↩️ Payment refunded',
                            'expired': '⏰ Payment expired'
                        };

                        const newEmbed = EmbedBuilder.from(embed);
                        const fields = newEmbed.data.fields;
                        const statusFieldIndex = fields.findIndex(f => f.name === '📊 Status');
                        
                        if (statusFieldIndex !== -1) {
                            fields[statusFieldIndex].value = statusEmojis[status] || status;
                            newEmbed.setFields(fields);
                            await message.edit({ embeds: [newEmbed], components: message.components });
                        }
                    }
                } catch (err) {
                    console.error('Error updating message:', err);
                }
            }

            if (status === 'finished' || status === 'confirmed') {
                clearInterval(checkInterval);
                paymentMonitors.delete(paymentId);
                
                const sessionData = paymentSessions.get(channelId);
                
                if (channel && sessionData) {
                    await processSuccessfulPayment(channel, sessionData);
                }
            } else if (status === 'failed' || status === 'expired') {
                clearInterval(checkInterval);
                paymentMonitors.delete(paymentId);
            }

        } catch (error) {
            console.error('Error monitoring payment:', error);
        }
    }, 15000);

    paymentMonitors.set(paymentId, checkInterval);

    setTimeout(() => {
        if (paymentMonitors.has(paymentId)) {
            clearInterval(paymentMonitors.get(paymentId));
            paymentMonitors.delete(paymentId);
        }
    }, 3600000);
}

async function processSuccessfulPayment(channel, sessionData) {
    const key = generateKey();
    const expiresAt = Date.now() + sessionData.durationMs;

    keysData.keys.push({
        key: key,
        userId: sessionData.userId,
        guildId: sessionData.guildId,
        duration: sessionData.duration,
        durationMs: sessionData.durationMs,
        expiresAt: expiresAt,
        createdAt: Date.now(),
        redeemed: false,
        paymentId: sessionData.paymentId
    });

    saveKeys();

    const successEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Payment Confirmed!')
        .setDescription('Your payment has been successfully confirmed!\n\nYour key has been sent to you via DM.')
        .setTimestamp();

    await channel.send({ embeds: [successEmbed] });

    try {
        const user = await client.users.fetch(sessionData.userId);
        
        const keyEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🔑 Your Key')
            .setDescription(`Here is your key:\n\n\`\`\`${key}\`\`\`\n\nUse \`/redeem ${key}\` to redeem your key and get access.`)
            .addFields(
                { name: '⏱️ Duration', value: sessionData.duration === 'test' ? '1 Hour' : sessionData.duration === '1day' ? '1 Day' : '1 Week', inline: true },
                { name: '💰 Price', value: `$${sessionData.priceUSD.toFixed(2)}`, inline: true },
                { name: '📅 Valid until', value: `<t:${Math.floor(expiresAt / 1000)}:F>`, inline: false }
            )
            .setFooter({ text: 'Keep this key safe!' })
            .setTimestamp();

        await user.send({ embeds: [keyEmbed] });

        const dmConfirmEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📬 Key Sent')
            .setDescription('The key has been sent to you via DM. Check your direct messages!')
            .setTimestamp();

        await channel.send({ embeds: [dmConfirmEmbed] });

    } catch (error) {
        console.error('Error sending DM:', error);
        
        const fallbackEmbed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('⚠️ DM Error')
            .setDescription(`I couldn't send you a DM. Here is your key:\n\n\`\`\`${key}\`\`\`\n\nUse \`/redeem ${key}\` to redeem your key.`)
            .setFooter({ text: 'Please enable DMs from server members!' })
            .setTimestamp();

        await channel.send({ content: `<@${sessionData.userId}>`, embeds: [fallbackEmbed] });
    }

    paymentSessions.delete(channel.id);
}

function generateKey() {
    return crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
}

async function handleRedeemCommand(interaction) {
    const keyInput = interaction.options.getString('key');
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    await interaction.deferReply({ ephemeral: true });

    if (!keysData || !keysData.keys || !Array.isArray(keysData.keys)) {
        return interaction.editReply({
            content: '❌ Error loading keys database. Please contact an administrator.'
        });
    }

    const keyData = keysData.keys.find(k => k.key === keyInput && k.guildId === guildId);

    if (!keyData) {
        return interaction.editReply({
            content: '❌ Invalid key or key does not belong to this server.'
        });
    }

    if (keyData.redeemed) {
        return interaction.editReply({
            content: '❌ This key has already been redeemed.'
        });
    }

    if (Date.now() > keyData.expiresAt) {
        return interaction.editReply({
            content: '❌ This key has expired.'
        });
    }

    if (!keysData.subscriptions || !Array.isArray(keysData.subscriptions)) {
        keysData.subscriptions = [];
    }

    const existingSub = keysData.subscriptions.find(s => s.userId === userId && s.guildId === guildId && s.active);

    if (existingSub) {
        return interaction.editReply({
            content: '❌ You already have an active subscription. Use `/check` to see your remaining time.'
        });
    }

    keyData.redeemed = true;
    keyData.redeemedBy = userId;
    keyData.redeemedAt = Date.now();

    const subscriptionEnd = Date.now() + keyData.durationMs;

    keysData.subscriptions.push({
        userId: userId,
        guildId: guildId,
        key: keyInput,
        startedAt: Date.now(),
        expiresAt: subscriptionEnd,
        duration: keyData.duration,
        active: true
    });

    saveKeys();

    const existingWhitelist = whitelistedUsers.users.find(u => u.userId === userId && u.guildId === guildId);

    if (!existingWhitelist) {
        whitelistedUsers.users.push({
            userId: userId,
            guildId: guildId,
            username: interaction.user.tag,
            whitelistedAt: Date.now(),
            expiresAt: subscriptionEnd,
            duration: keyData.duration,
            active: true
        });
        saveWhitelist();
    } else {
        existingWhitelist.expiresAt = subscriptionEnd;
        existingWhitelist.active = true;
        existingWhitelist.duration = keyData.duration;
        saveWhitelist();
    }

    const successEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Key Successfully Redeemed!')
        .setDescription(`Your key has been successfully redeemed!\n\nYou are now **whitelisted** for **${keyData.duration === 'test' ? '1 Hour' : keyData.duration === '1day' ? '1 Day' : '1 Week'}**.`)
        .addFields(
            { name: '✅ Status', value: 'Whitelisted', inline: true },
            { name: '📅 Expires', value: `<t:${Math.floor(subscriptionEnd / 1000)}:R>`, inline: true }
        )
        .setFooter({ text: 'Use /check to check your remaining time' })
        .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });
}

async function handleCheckCommand(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    await interaction.deferReply({ ephemeral: true });

    if (!keysData || !keysData.subscriptions || !Array.isArray(keysData.subscriptions)) {
        return interaction.editReply({
            content: '❌ You don\'t have an active subscription. Buy a key with `!ticket buy`.'
        });
    }

    const subscription = keysData.subscriptions.find(s => s.userId === userId && s.guildId === guildId && s.active);

    if (!subscription) {
        return interaction.editReply({
            content: '❌ You don\'t have an active subscription. Buy a key with `!ticket buy`.'
        });
    }

    const timeLeft = subscription.expiresAt - Date.now();

    if (timeLeft <= 0) {
        subscription.active = false;
        saveKeys();

        return interaction.editReply({
            content: '❌ Your subscription has expired.'
        });
    }

    const hours = Math.floor(timeLeft / 3600000);
    const minutes = Math.floor((timeLeft % 3600000) / 60000);
    const seconds = Math.floor((timeLeft % 60000) / 1000);

    const checkEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('⏱️ Your Subscription Info')
        .setDescription(`Your subscription is active!`)
        .addFields(
            { name: '📅 Expires', value: `<t:${Math.floor(subscription.expiresAt / 1000)}:F>`, inline: false },
            { name: '⏳ Time Remaining', value: `${hours}h ${minutes}m ${seconds}s`, inline: false },
            { name: '✅ Status', value: 'Whitelisted', inline: true },
            { name: '📦 Package', value: subscription.duration === 'test' ? '1 Hour (Test)' : subscription.duration === '1day' ? '1 Day' : '1 Week', inline: true }
        )
        .setFooter({ text: 'Your access will expire automatically' })
        .setTimestamp();

    await interaction.editReply({ embeds: [checkEmbed] });
}

async function handleWhitelistCommand(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    await interaction.deferReply({ ephemeral: true });

    const whitelistEntry = whitelistedUsers.users.find(u => u.userId === userId && u.guildId === guildId && u.active);

    if (!whitelistEntry) {
        return interaction.editReply({
            content: '❌ You are not whitelisted.\n\nTo get whitelist, buy here: <#1504392067806269531>'
        });
    }

    const timeLeft = whitelistEntry.expiresAt - Date.now();

    if (timeLeft <= 0) {
        whitelistEntry.active = false;
        saveWhitelist();

        return interaction.editReply({
            content: '❌ Your whitelist has expired.\n\nTo get whitelist, buy here: <#1504392067806269531>'
        });
    }

    const hours = Math.floor(timeLeft / 3600000);
    const minutes = Math.floor((timeLeft % 3600000) / 60000);
    const seconds = Math.floor((timeLeft % 60000) / 1000);

    const whitelistEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Whitelist Status')
        .setDescription(`You are currently whitelisted!`)
        .addFields(
            { name: '👤 User', value: `${interaction.user.tag}`, inline: true },
            { name: '✅ Status', value: 'Active', inline: true },
            { name: '📅 Expires', value: `<t:${Math.floor(whitelistEntry.expiresAt / 1000)}:F>`, inline: false },
            { name: '⏳ Time Remaining', value: `${hours}h ${minutes}m ${seconds}s`, inline: false },
            { name: '📦 Package', value: whitelistEntry.duration === 'test' ? '1 Hour (Test)' : whitelistEntry.duration === '1day' ? '1 Day' : '1 Week', inline: true }
        )
        .setFooter({ text: 'Your whitelist will expire automatically' })
        .setTimestamp();

    await interaction.editReply({ embeds: [whitelistEmbed] });
}

async function handleUnwhitelistCommand(interaction) {
    const userId = interaction.user.id;
    
    if (!ADMIN_USER_IDS.includes(userId)) {
        return interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true
        });
    }

    const targetUser = interaction.options.getUser('user');
    const guildId = interaction.guild.id;

    await interaction.deferReply({ ephemeral: true });

    const whitelistEntry = whitelistedUsers.users.find(u => u.userId === targetUser.id && u.guildId === guildId);

    if (!whitelistEntry || !whitelistEntry.active) {
        return interaction.editReply({
            content: `❌ ${targetUser} is not whitelisted.`
        });
    }

    whitelistEntry.active = false;
    saveWhitelist();

    const subscription = keysData.subscriptions.find(s => s.userId === targetUser.id && s.guildId === guildId && s.active);
    if (subscription) {
        subscription.active = false;
        saveKeys();
    }

    const successEmbed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('✅ User Unwhitelisted')
        .setDescription(`${targetUser} has been removed from the whitelist.`)
        .addFields(
            { name: '👤 User', value: `${targetUser.tag}`, inline: true },
            { name: '❌ Status', value: 'Removed', inline: true }
        )
        .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });

    try {
        const unwhitelistEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ Whitelist Removed')
            .setDescription('Your whitelist has been removed by an administrator.')
            .setFooter({ text: 'Contact staff if you believe this was a mistake' })
            .setTimestamp();

        await targetUser.send({ embeds: [unwhitelistEmbed] });
    } catch (error) {
        console.error('Error sending DM:', error);
    }
}

async function handleGiveKeyCommand(interaction) {
    const userId = interaction.user.id;
    
    if (!ADMIN_USER_IDS.includes(userId)) {
        return interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true
        });
    }

    const targetUser = interaction.options.getUser('user');
    const duration = interaction.options.getString('duration');

    await interaction.deferReply({ ephemeral: true });

    const durationMs = duration === 'test' ? 3600000 : duration === '1day' ? 86400000 : 604800000;
    const key = generateKey();
    const expiresAt = Date.now() + durationMs;

    keysData.keys.push({
        key: key,
        userId: targetUser.id,
        guildId: interaction.guild.id,
        duration: duration,
        durationMs: durationMs,
        expiresAt: expiresAt,
        createdAt: Date.now(),
        redeemed: false,
        givenBy: interaction.user.id
    });

    saveKeys();

    try {
        const keyEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎁 You Received a Key!')
            .setDescription(`You have been given a key by an administrator!\n\n\`\`\`${key}\`\`\`\n\nUse \`/redeem ${key}\` to redeem your key and get access.`)
            .addFields(
                { name: '⏱️ Duration', value: duration === 'test' ? '1 Hour' : duration === '1day' ? '1 Day' : '1 Week', inline: true },
                { name: '📅 Valid until', value: `<t:${Math.floor(expiresAt / 1000)}:F>`, inline: false }
            )
            .setFooter({ text: 'Keep this key safe!' })
            .setTimestamp();

        await targetUser.send({ embeds: [keyEmbed] });

        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Key Generated')
            .setDescription(`Key has been generated and sent to ${targetUser}`)
            .addFields(
                { name: '🔑 Key', value: `\`${key}\``, inline: false },
                { name: '👤 User', value: `${targetUser}`, inline: true },
                { name: '⏱️ Duration', value: duration === 'test' ? '1 Hour' : duration === '1day' ? '1 Day' : '1 Week', inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        console.error('Error sending key:', error);
        
        const fallbackEmbed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('⚠️ DM Error')
            .setDescription(`Couldn't send DM to ${targetUser}. Here is the key:\n\n\`\`\`${key}\`\`\`\n\nPlease send it to them manually.`)
            .setTimestamp();

        await interaction.editReply({ embeds: [fallbackEmbed] });
    }
}

async function handleGenCommand(interaction) {
    const game = interaction.options.getString('game');
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    await interaction.deferReply({ ephemeral: true });

    const whitelistEntry = whitelistedUsers.users.find(u => u.userId === userId && u.guildId === guildId && u.active);

    if (!whitelistEntry) {
        return interaction.editReply({
            content: '❌ You don\'t have gen access.\n\nTo buy, go here: <#1504392067806269531>'
        });
    }

    if (Date.now() > whitelistEntry.expiresAt) {
        whitelistEntry.active = false;
        saveWhitelist();
        
        return interaction.editReply({
            content: '❌ Your whitelist has expired.\n\nTo buy, go here: <#1504392067806269531>'
        });
    }

    const cooldownKey = `${userId}-${guildId}`;
    const cooldownData = genCooldowns.get(cooldownKey);

    if (cooldownData && Date.now() < cooldownData) {
        const timeLeft = cooldownData - Date.now();
        const hours = Math.floor(timeLeft / 3600000);
        const minutes = Math.floor((timeLeft % 3600000) / 60000);

        return interaction.editReply({
            content: `❌ You are on cooldown! You can use /gen again in **${hours}h ${minutes}m**.\n\nUse \`/stock\` to check available accounts.`
        });
    }

    const fileName = game === 'valo' ? 'valo.txt' : 'fortnite.txt';
    const gameName = game === 'valo' ? 'Valorant' : 'Fortnite';

    try {
        const accounts = fs.readFileSync(`./${fileName}`, 'utf8').split('\n').filter(line => line.trim() !== '');

        if (accounts.length === 0) {
            return interaction.editReply({
                content: `❌ No ${gameName} accounts available in stock. Please try again later.`
            });
        }

        const account = accounts[0];
        const remainingAccounts = accounts.slice(1);

        fs.writeFileSync(`./${fileName}`, remainingAccounts.join('\n'));

        genCooldowns.set(cooldownKey, Date.now() + GEN_COOLDOWN);

        try {
            const accountEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle(`🎮 ${gameName} Account`)
                .setDescription(`Here is your ${gameName} account:\n\n\`\`\`${account}\`\`\``)
                .setFooter({ text: 'Keep this account information safe!' })
                .setTimestamp();

            await interaction.user.send({ embeds: [accountEmbed] });

            const successEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Account Generated')
                .setDescription(`Your ${gameName} account has been sent to your DMs!`)
                .addFields(
                    { name: '📦 Game', value: gameName, inline: true },
                    { name: '📊 Remaining Stock', value: `${remainingAccounts.length}`, inline: true },
                    { name: '⏱️ Next Gen Available', value: `<t:${Math.floor((Date.now() + GEN_COOLDOWN) / 1000)}:R>`, inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error sending DM:', error);
            
            const fallbackEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ DM Error')
                .setDescription(`I couldn't send you a DM. Here is your ${gameName} account:\n\n\`\`\`${account}\`\`\``)
                .addFields(
                    { name: '⏱️ Next Gen Available', value: `<t:${Math.floor((Date.now() + GEN_COOLDOWN) / 1000)}:R>`, inline: false }
                )
                .setFooter({ text: 'Please enable DMs from server members!' })
                .setTimestamp();

            await interaction.editReply({ embeds: [fallbackEmbed] });
        }

        await updateStockWebhook();

    } catch (error) {
        console.error('Error reading accounts file:', error);
        await interaction.editReply({
            content: '❌ Error reading accounts file. Please contact an administrator.'
        });
    }}

async function handleFreeGenCommand(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    await interaction.deferReply({ ephemeral: true });

    try {
        const member = await interaction.guild.members.fetch(userId);
        const hasRequiredStatus = checkUserStatus(member);

        if (!hasRequiredStatus) {
            return interaction.editReply({
                content: `❌ You need to have \`${REQUIRED_STATUS}\` in your Discord status to use /freegen!\n\n**How to add it:**\n1. Click on your profile\n2. Set Custom Status\n3. Add \`${REQUIRED_STATUS}\` to your status\n4. Try again!`
            });
        }
    } catch (error) {
        console.error('Error checking user status:', error);
        return interaction.editReply({
            content: '❌ Error checking your status. Please try again later.'
        });
    }

    const cooldownKey = `${userId}-${guildId}`;
    const cooldownData = freeGenCooldowns.get(cooldownKey);

    if (cooldownData && Date.now() < cooldownData) {
        const timeLeft = cooldownData - Date.now();
        const hours = Math.floor(timeLeft / 3600000);
        const minutes = Math.floor((timeLeft % 3600000) / 60000);

        return interaction.editReply({
            content: `❌ You are on cooldown! You can use /freegen again in **${hours}h ${minutes}m**.\n\nTo get premium access with 12h cooldown, go here: <#1504392067806269531>`
        });
    }

    const fileName = 'freevalo.txt';
    const gameName = 'Valorant (Free)';

    try {
        const accounts = fs.readFileSync(`./${fileName}`, 'utf8').split('\n').filter(line => line.trim() !== '');

        if (accounts.length === 0) {
            return interaction.editReply({
                content: `❌ No free ${gameName} accounts available in stock. Please try again later.`
            });
        }

        const account = accounts[0];
        const remainingAccounts = accounts.slice(1);

        fs.writeFileSync(`./${fileName}`, remainingAccounts.join('\n'));

        freeGenCooldowns.set(cooldownKey, Date.now() + FREE_GEN_COOLDOWN);

        try {
            const accountEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle(`🎮 ${gameName} Account`)
                .setDescription(`Here is your free Valorant account:\n\n\`\`\`${account}\`\`\``)
                .setFooter({ text: 'Keep this account information safe!' })
                .setTimestamp();

            await interaction.user.send({ embeds: [accountEmbed] });

            const successEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Free Account Generated')
                .setDescription(`Your free Valorant account has been sent to your DMs!`)
                .addFields(
                    { name: '📦 Game', value: 'Valorant (Free)', inline: true },
                    { name: '📊 Remaining Stock', value: `${remainingAccounts.length}`, inline: true },
                    { name: '⏱️ Next Free Gen Available', value: `<t:${Math.floor((Date.now() + FREE_GEN_COOLDOWN) / 1000)}:R>`, inline: false }
                )
                .setFooter({ text: 'Want faster cooldowns? Get premium access!' })
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error sending DM:', error);
            
            const fallbackEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ DM Error')
                .setDescription(`I couldn't send you a DM. Here is your free Valorant account:\n\n\`\`\`${account}\`\`\``)
                .addFields(
                    { name: '⏱️ Next Free Gen Available', value: `<t:${Math.floor((Date.now() + FREE_GEN_COOLDOWN) / 1000)}:R>`, inline: false }
                )
                .setFooter({ text: 'Please enable DMs from server members!' })
                .setTimestamp();

            await interaction.editReply({ embeds: [fallbackEmbed] });
        }

        await updateStockWebhook();

    } catch (error) {
        console.error('Error reading accounts file:', error);
        await interaction.editReply({
            content: '❌ Error reading accounts file. Please contact an administrator.'
        });
    }
}

async function handleStockCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const valoAccounts = fs.readFileSync('./valo.txt', 'utf8').split('\n').filter(line => line.trim() !== '');
        const fortniteAccounts = fs.readFileSync('./fortnite.txt', 'utf8').split('\n').filter(line => line.trim() !== '');
        const freeValoAccounts = fs.readFileSync('./freevalo.txt', 'utf8').split('\n').filter(line => line.trim() !== '');

        const stockEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📊 Account Stock')
            .setDescription('Current available accounts:')
            .addFields(
                { name: '🎮 Valorant (Premium)', value: `${valoAccounts.length} accounts`, inline: true },
                { name: '🎮 Fortnite (Premium)', value: `${fortniteAccounts.length} accounts`, inline: true },
                { name: '🆓 Valorant (Free)', value: `${freeValoAccounts.length} accounts`, inline: true }
            )
            .setFooter({ text: 'Use /gen for premium or /freegen for free accounts' })
            .setTimestamp();

        await interaction.editReply({ embeds: [stockEmbed] });

    } catch (error) {
        console.error('Error reading stock:', error);
        await interaction.editReply({
            content: '❌ Error reading stock information.'
        });
    }
}

async function handleRemoveCooldownCommand(interaction) {
    const userId = interaction.user.id;
    
    if (!ADMIN_USER_IDS.includes(userId)) {
        return interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true
        });
    }

    const targetUser = interaction.options.getUser('user');
    const guildId = interaction.guild.id;

    await interaction.deferReply({ ephemeral: true });

    const cooldownKey = `${targetUser.id}-${guildId}`;
    
    const hasGenCooldown = genCooldowns.has(cooldownKey);
    const hasFreeGenCooldown = freeGenCooldowns.has(cooldownKey);

    if (!hasGenCooldown && !hasFreeGenCooldown) {
        return interaction.editReply({
            content: `❌ ${targetUser} doesn't have any active cooldowns.`
        });
    }

    if (hasGenCooldown) {
        genCooldowns.delete(cooldownKey);
    }
    
    if (hasFreeGenCooldown) {
        freeGenCooldowns.delete(cooldownKey);
    }

    const successEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Cooldown Removed')
        .setDescription(`All cooldowns have been removed for ${targetUser}`)
        .addFields(
            { name: '👤 User', value: `${targetUser}`, inline: true },
            { name: '✅ Status', value: 'Can use /gen and /freegen immediately', inline: true }
        )
        .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });
}

async function initializeStockWebhook() {
    try {
        const valoAccounts = fs.readFileSync('./valo.txt', 'utf8').split('\n').filter(line => line.trim() !== '');
        const fortniteAccounts = fs.readFileSync('./fortnite.txt', 'utf8').split('\n').filter(line => line.trim() !== '');
        const freeValoAccounts = fs.readFileSync('./freevalo.txt', 'utf8').split('\n').filter(line => line.trim() !== '');

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📊 Live Account Stock')
            .setDescription('Real-time account availability:')
            .addFields(
                { name: '🎮 Valorant (Premium)', value: `**${valoAccounts.length}** accounts`, inline: true },
                { name: '🎮 Fortnite (Premium)', value: `**${fortniteAccounts.length}** accounts`, inline: true },
                { name: '🆓 Valorant (Free)', value: `**${freeValoAccounts.length}** accounts`, inline: true }
            )
            .setFooter({ text: 'Updates automatically when stock changes' })
            .setTimestamp();

        if (stockMessageId) {
            try {
                await axios.patch(`${WEBHOOK_URL}/messages/${stockMessageId}`, {
                    embeds: [embed.toJSON()]
                });
                console.log('✅ Stock webhook message updated');
            } catch (error) {
                if (error.response?.status === 404) {
                    console.log('⚠️ Stock message not found, creating new one...');
                    const response = await axios.post(`${WEBHOOK_URL}?wait=true`, {
                        embeds: [embed.toJSON()]
                    });
                    saveStockMessageId(response.data.id);
                    console.log('✅ New stock webhook message created');
                } else {
                    throw error;
                }
            }
        } else {
            const response = await axios.post(`${WEBHOOK_URL}?wait=true`, {
                embeds: [embed.toJSON()]
            });
            saveStockMessageId(response.data.id);
            console.log('✅ Stock webhook message created');
        }
    } catch (error) {
        console.error('Error initializing stock webhook:', error);
    }
}

async function updateStockWebhook() {
    if (!stockMessageId) {
        await initializeStockWebhook();
        return;
    }

    try {
        const valoAccounts = fs.readFileSync('./valo.txt', 'utf8').split('\n').filter(line => line.trim() !== '');
        const fortniteAccounts = fs.readFileSync('./fortnite.txt', 'utf8').split('\n').filter(line => line.trim() !== '');
        const freeValoAccounts = fs.readFileSync('./freevalo.txt', 'utf8').split('\n').filter(line => line.trim() !== '');

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📊 Live Account Stock')
            .setDescription('Real-time account availability:')
            .addFields(
                { name: '🎮 Valorant (Premium)', value: `**${valoAccounts.length}** accounts`, inline: true },
                { name: '🎮 Fortnite (Premium)', value: `**${fortniteAccounts.length}** accounts`, inline: true },
                { name: '🆓 Valorant (Free)', value: `**${freeValoAccounts.length}** accounts`, inline: true }
            )
            .setFooter({ text: 'Updates automatically when stock changes' })
            .setTimestamp();

        await axios.patch(`${WEBHOOK_URL}/messages/${stockMessageId}`, {
            embeds: [embed.toJSON()]
        });
    } catch (error) {
        if (error.response?.status === 404) {
            console.log('⚠️ Stock message not found, creating new one...');
            await initializeStockWebhook();
        } else {
            console.error('Error updating stock webhook:', error);
        }
    }
}

function watchStockFiles() {
    fs.watch('./valo.txt', async (eventType) => {
        if (eventType === 'change') {
            await updateStockWebhook();
        }
    });

    fs.watch('./fortnite.txt', async (eventType) => {
        if (eventType === 'change') {
            await updateStockWebhook();
        }
    });

    fs.watch('./freevalo.txt', async (eventType) => {
        if (eventType === 'change') {
            await updateStockWebhook();
        }
    });
}

async function checkExpiredSubscriptions() {
    const now = Date.now();
    let changed = false;

    if (!keysData || !keysData.subscriptions || !Array.isArray(keysData.subscriptions)) {
        return;
    }

    for (const sub of keysData.subscriptions) {
        if (sub.active && sub.expiresAt <= now) {
            sub.active = false;
            changed = true;

            const whitelistEntry = whitelistedUsers.users.find(u => u.userId === sub.userId && u.guildId === sub.guildId);
            if (whitelistEntry) {
                whitelistEntry.active = false;
                saveWhitelist();
            }

            try {
                const user = await client.users.fetch(sub.userId);
                const expiredEmbed = new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('⏰ Subscription Expired')
                    .setDescription('Your subscription has expired. Your whitelist has been removed.')
                    .addFields(
                        { name: '📦 Package', value: sub.duration === 'test' ? '1 Hour (Test)' : sub.duration === '1day' ? '1 Day' : '1 Week', inline: true },
                        { name: '📅 Expired at', value: `<t:${Math.floor(sub.expiresAt / 1000)}:F>`, inline: true }
                    )
                    .setFooter({ text: 'Purchase a new key with !ticket buy' })
                    .setTimestamp();

                await user.send({ embeds: [expiredEmbed] }).catch(() => {});
            } catch (error) {
                console.error('Error sending expiration message:', error);
            }
        }
    }

    if (changed) {
        saveKeys();
    }
}

async function handleTicketClose(interaction) {
    const channelId = interaction.customId.replace('close_ticket_', '');
    const channel = interaction.guild.channels.cache.get(channelId);

    if (!channel) {
        return interaction.reply({ content: '❌ Ticket channel not found.', ephemeral: true });
    }

    const ticketData = activeTickets.get(channelId);

    if (!ticketData) {
        return interaction.reply({ content: '❌ Ticket data not found.', ephemeral: true });
    }

    await interaction.reply({ content: '🔒 Closing ticket...', ephemeral: true });

    const closeEmbed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('🔒 Ticket Closed')
        .setDescription(`This ticket was closed by ${interaction.user}.`)
        .setTimestamp();

    await channel.send({ embeds: [closeEmbed] });

    activeTickets.delete(channelId);
    paymentSessions.delete(channelId);

    if (paymentMonitors.has(channelId)) {
        clearInterval(paymentMonitors.get(channelId));
        paymentMonitors.delete(channelId);
    }

    setTimeout(async () => {
        try {
            await channel.delete();
        } catch (error) {
            console.error('Error deleting channel:', error);
        }
    }, 5000);
}

client.login(process.env.DISCORD_TOKEN);
