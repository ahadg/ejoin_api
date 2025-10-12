const Campaign = require('../models/Campaign');
const Device = require('../models/Device');
const CampaignStats = require('../models/campaignStats');
const ContactList = require('../models/ContactList');
const Sim = require('../models/Sim');
const SimMessages = require('../models/SimMessages');

// Get comprehensive dashboard statistics
exports.getDashboardStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Get all data in parallel for better performance
    const [
      devices,
      campaigns,
      todayStats,
      yesterdayStats,
      contactLists,
      sims,
      recentMessages
    ] = await Promise.all([
      Device.find({ user: userId }),
      Campaign.find({ user: userId }),
      CampaignStats.find({ user: userId, date: { $gte: today, $lt: tomorrow } }),
      CampaignStats.find({ user: userId, date: { $gte: yesterday, $lt: today } }),
      ContactList.find({ user: userId }),
      Sim.find({ device: { $in: await Device.find({ user: userId }).select('_id') } })
        .populate('device', 'name status'),
      SimMessages.find({ 
        sim: { $in: await Sim.find({ device: { $in: await Device.find({ user: userId }).select('_id') } }).select('_id') }
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('sim', 'phoneNumber operator')
    ]);
    
    console.log({ todayStats, yesterdayStats });

    // Device Statistics
    const totalDevices = devices.length;
    const activeDevices = devices.filter(d => d.status === 'online').length;
    
    // SIM Statistics
    const totalSIMs = devices?.[0]?.totalSlots;
    const activeSIMs = devices?.[0]?.activeSlots;
    const simsWithSignal = sims.filter(sim => sim.signalStrength && sim.signalStrength > 0);
    const averageSignal = simsWithSignal.length > 0 
      ? simsWithSignal.reduce((sum, sim) => sum + sim.signalStrength, 0) / simsWithSignal.length 
      : 0;

    // Campaign Statistics
    const totalCampaigns = campaigns.length;
    const activeCampaigns = campaigns.filter(c => c.status === 'active').length;
    const totalContacts = contactLists.reduce((sum, list) => sum + (list.totalContacts || 0), 0);

    // Message Statistics
    const totalSentToday = todayStats.reduce((sum, stat) => sum + (stat.sentMessages || 0), 0);
    const totalDeliveredToday = todayStats.reduce((sum, stat) => sum + (stat.deliveredMessages || 0), 0);
    const totalFailedToday = todayStats.reduce((sum, stat) => sum + (stat.failedMessages || 0), 0);
    
    const totalSentYesterday = yesterdayStats.reduce((sum, stat) => sum + (stat.sentMessages || 0), 0);
    const messageTrend = totalSentYesterday > 0 
      ? ((totalSentToday - totalSentYesterday) / totalSentYesterday * 100).toFixed(1)
      : 0;

    // Overall Campaign Performance
    const totalSentAllTime = campaigns.reduce((sum, campaign) => sum + (campaign.sentMessages || 0), 0);
    const totalDeliveredAllTime = campaigns.reduce((sum, campaign) => sum + (campaign.deliveredMessages || 0), 0);
    const totalFailedAllTime = campaigns.reduce((sum, campaign) => sum + (campaign.failedMessages || 0), 0);
    
    const successRate = totalSentAllTime > 0 
      ? ((totalDeliveredAllTime / totalSentAllTime) * 100).toFixed(1)
      : 0;

    // Processing Time Statistics (Updated from cost)
    const totalProcessingTimeToday = todayStats.reduce((sum, stat) => sum + (stat.averageProcessingTime || 0), 0);
    const avgProcessingTimeToday = todayStats.length > 0 
      ? totalProcessingTimeToday / todayStats.length 
      : 0;
    
    const totalProcessingTimeAllTime = campaigns.reduce((sum, campaign) => sum + (campaign.averageProcessingTime || 0), 0);
    const avgProcessingTimeAllTime = campaigns.length > 0 
      ? totalProcessingTimeAllTime / campaigns.length 
      : 0;

    // Recent Activity
    const recentActivity = recentMessages.map(msg => ({
      type: 'message',
      direction: msg.direction,
      phoneNumber: msg.to || msg.from,
      content: msg.sms?.substring(0, 50) + (msg.sms?.length > 50 ? '...' : ''),
      timestamp: msg.createdAt,
      status: msg.status
    }));

    // Performance Metrics
    const deliveryRate = totalSentToday > 0 ? (totalDeliveredToday / totalSentToday * 100).toFixed(1) : 0;
    const failureRate = totalSentToday > 0 ? (totalFailedToday / totalSentToday * 100).toFixed(1) : 0;

    res.json({
      code: 200,
      data: {
        // Core Stats for Cards
        activeDevices: `${activeDevices}/${totalDevices}`,
        activeSIMs: `${activeSIMs || 0}/${totalSIMs || 0}`,
        messagesSentToday: totalSentToday,
        successRate: `${successRate}%`,
        
        // Additional Stats
        totalCampaigns,
        activeCampaigns,
        totalContacts,
        averageProcessingTimeToday: parseFloat(avgProcessingTimeToday.toFixed(2)), 
        averageProcessingTimeAllTime: parseFloat(avgProcessingTimeAllTime.toFixed(2)), 
        
        // Performance Metrics
        performance: {
          deliveryRate: `${deliveryRate}%`,
          failureRate: `${failureRate}%`,
          averageSignal: Math.round(averageSignal),
          messageTrend: parseFloat(messageTrend),
          avgProcessingTime: parseFloat(avgProcessingTimeToday.toFixed(2)) 
        },
        
        // Device Health
        deviceHealth: {
          online: activeDevices,
          offline: totalDevices - activeDevices,
          warning: devices.filter(d => d.status === 'warning').length
        },
        
        // SIM Health
        simHealth: {
          active: activeSIMs,
          inactive: totalSIMs - activeSIMs,
          goodSignal: sims.filter(sim => sim.signalStrength > 20).length,
          weakSignal: sims.filter(sim => sim.signalStrength <= 20 && sim.signalStrength > 0).length
        },
        
        // Campaign Progress
        campaignProgress: campaigns.map(campaign => ({
          name: campaign.name,
          progress: campaign.totalContacts > 0 
            ? Math.min(100, (campaign.sentMessages / campaign.totalContacts) * 100)
            : 0,
          status: campaign.status,
          sent: campaign.sentMessages,
          total: campaign.totalContacts,
          averageProcessingTime: parseFloat((campaign.averageProcessingTime || 0).toFixed(2))
        })),
        
        // Recent Activity
        recentActivity,
        
        // Processing Time Insights (Optional - if you want to show more detailed metrics)
        processingInsights: {
          fastestCampaign: campaigns.length > 0 
            ? Math.min(...campaigns.map(c => c.averageProcessingTime || 0)).toFixed(2)
            : 0,
          slowestCampaign: campaigns.length > 0 
            ? Math.max(...campaigns.map(c => c.averageProcessingTime || 0)).toFixed(2)
            : 0,
          todayVsAllTime: parseFloat((avgProcessingTimeToday - avgProcessingTimeAllTime).toFixed(2))
        }
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ code: 500, reason: 'Error fetching dashboard statistics' });
  }
};

// Get real-time device status with detailed SIM information
exports.getDashboardDevices = async (req, res) => {
  try {
    const devices = await Device.find({ user: req.user._id })
      .select('name status ipAddress location totalSlots activeSlots lastSeen temperature uptime dailySent dailyLimit firmwareVersion')
      .sort({ status: -1, createdAt: -1 });

    // Get SIM data for each device
    const devicesWithSims = await Promise.all(
      devices.map(async (device) => {
        const sims = await Sim.find({ device: device._id })
          .select('portNumber phoneNumber status operator signalStrength networkType balance lastUpdated');
        
        const activeSims = sims.filter(sim => sim.status === 'active');
        const simsWithGoodSignal = activeSims.filter(sim => sim.signalStrength > 20);
        
        return {
          _id: device._id,
          name: device.name,
          status: device.status,
          ipAddress: device.ipAddress,
          location: device.location,
          totalSlots: device.totalSlots,
          activeSlots: device.activeSlots,
          lastSeen: device.lastSeen,
          temperature: device.temperature,
          uptime: device.uptime,
          dailyUsage: {
            sent: device.dailySent || 0,
            limit: device.dailyLimit || 15000
          },
          firmwareVersion: device.firmwareVersion,
          simHealth: {
            total: sims.length,
            active: activeSims.length,
            goodSignal: simsWithGoodSignal.length,
            operators: [...new Set(activeSims.map(sim => sim.operator).filter(Boolean))]
          },
          sims: sims.slice(0, 4) // Show first 4 SIMs for preview
        };
      })
    );

    res.json({
      code: 200,
      data: {
        devices: devicesWithSims,
        summary: {
          totalDevices: devices.length,
          onlineDevices: devices.filter(d => d.status === 'online').length,
          totalSIMs: devices.reduce((sum, device) => sum + device.totalSlots, 0),
          activeSIMs: devicesWithSims.reduce((sum, device) => sum + device.activeSlots, 0)
        }
      }
    });
  } catch (error) {
    console.error('Get dashboard devices error:', error);
    res.status(500).json({ code: 500, reason: 'Error fetching devices' });
  }
};

exports.getRecentCampaigns = async (req, res) => {
    try {
      const { limit = 5 } = req.query;
      
      const campaigns = await Campaign.find({ user: req.user._id })
        .populate('contactList', 'name totalContacts')
        .populate('device', 'name')
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(parseInt(limit));
      
      // Format campaigns for dashboard display
      const formattedCampaigns = campaigns.map(campaign => {
        const progress = campaign.totalContacts > 0 
          ? ((campaign.sentMessages / campaign.totalContacts) * 100) 
          : 0;
        
        // Calculate ETA (simplified calculation)
        let eta = 'N/A';
        if (campaign.status === 'active' && progress > 0 && progress < 100) {
          const timeElapsed = new Date() - campaign.updatedAt;
          const messagesPerHour = (campaign.sentMessages / Math.max(timeElapsed / (1000 * 60 * 60), 0.1)) || 1;
          const remainingMessages = campaign.totalContacts - campaign.sentMessages;
          const hoursRemaining = remainingMessages / messagesPerHour;
          
          if (hoursRemaining < 1) {
            eta = `${Math.ceil(hoursRemaining * 60)}m`;
          } else {
            eta = `${Math.ceil(hoursRemaining)}h`;
          }
        } else if (campaign.status === 'paused') {
          eta = 'Paused';
        } else if (campaign.status === 'completed') {
          eta = 'Completed';
        }
        
        return {
          _id: campaign._id,
          name: campaign.name,
          status: campaign.status,
          progress: Math.min(progress, 100),
          sentMessages: campaign.sentMessages || 0,
          totalContacts: campaign.totalContacts || 0,
          eta
        };
      });
      
      res.json({
        code: 200,
        data: {
          campaigns: formattedCampaigns
        }
      });
    } catch (error) {
      console.error('Get recent campaigns error:', error);
      res.status(500).json({ code: 500, reason: 'Error fetching recent campaigns' });
    }
  };

// Get campaign performance analytics
exports.getCampaignAnalytics = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const userId = req.user._id;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    const campaignStats = await CampaignStats.find({
      user: userId,
      date: { $gte: startDate }
    }).sort({ date: 1 });

    // Group by date for chart data
    const dailyData = {};
    campaignStats.forEach(stat => {
      const dateStr = stat.date.toISOString().split('T')[0];
      if (!dailyData[dateStr]) {
        dailyData[dateStr] = { sent: 0, delivered: 0, failed: 0, cost: 0 };
      }
      dailyData[dateStr].sent += stat.sentMessages || 0;
      dailyData[dateStr].delivered += stat.deliveredMessages || 0;
      dailyData[dateStr].failed += stat.failedMessages || 0;
      dailyData[dateStr].cost += stat.cost || 0;
    });

    const chartData = Object.keys(dailyData).map(date => ({
      date,
      ...dailyData[date]
    }));

    res.json({
      code: 200,
      data: {
        chartData,
        period: parseInt(days)
      }
    });
  } catch (error) {
    console.error('Get campaign analytics error:', error);
    res.status(500).json({ code: 500, reason: 'Error fetching campaign analytics' });
  }
};