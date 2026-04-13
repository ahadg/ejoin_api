const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const Sim = require('../models/Sim');
const User = require('../models/User');

class CampaignSimService {
  constructor({ simRoundRobinIndex }) {
    this.simRoundRobinIndex = simRoundRobinIndex;
  }

  buildActiveSimQuery(deviceId, assignedSimIds = null) {
    const query = {
      device: deviceId,
      inserted: true,
      slotActive: true,
      status: 'active'
    };

    if (Array.isArray(assignedSimIds)) {
      query._id = { $in: assignedSimIds };
    }

    return query;
  }

  async getCampaignScopedSims(campaign, deviceId) {
    if (campaign?.user?.role !== 'user') {
      console.log(`User is admin, fetching all active SIMs for device`);
      return Sim.find(this.buildActiveSimQuery(deviceId, null)).sort({ port: 1, slot: 1 });
    }

    const userId = campaign?.user?._id || campaign?.user;
    const freshUser = await User.findById(userId).select('role assignedSims');
    const assignedSimIds = Array.isArray(freshUser?.assignedSims) ? freshUser.assignedSims : [];

    console.log(
      `User is regular user, fetching from assignedSims (${assignedSimIds.length}): ${assignedSimIds.join(', ')}`
    );

    if (assignedSimIds.length === 0) {
      throw new Error(`No SIMs assigned to user ${userId}`);
    }

    return Sim.find(this.buildActiveSimQuery(deviceId, assignedSimIds)).sort({ port: 1, slot: 1 });
  }

  isSimAvailableForSending(sim, deviceId) {
    return Boolean(
      sim &&
      sim.device?.toString() === deviceId.toString() &&
      sim.inserted &&
      sim.slotActive &&
      sim.status === 'active'
    );
  }

  async resetSimDailyCountIfNeeded(sim) {
    const today = new Date().toDateString();
    const lastReset = sim.lastResetDate.toDateString();

    if (today !== lastReset) {
      await Sim.findByIdAndUpdate(sim._id, {
        dailySent: 0,
        todaySent: 0,
        lastResetDate: new Date()
      });
    }
  }

  async getAvailableSims(deviceId, campaignId) {
    try {
      console.log("deviceId", deviceId, "campaignId", campaignId);

      const campaign = await Campaign.findById(campaignId).populate('user');
      if (!campaign) {
        throw new Error(`Campaign ${campaignId} not found`);
      }

      const sims = await this.getCampaignScopedSims(campaign, deviceId);
      console.log("sims", sims)
      if (sims.length === 0) {
        throw new Error(`No active SIMs found for device ${deviceId}`);
      }

      const availableSims = [];
      for (const sim of sims) {
        await this.resetSimDailyCountIfNeeded(sim);

        if (sim.dailySent < sim.dailyLimit) {
          availableSims.push(sim);
        }
      }

      if (availableSims.length === 0) {
        throw new Error(`All SIMs have reached their daily limits for device ${deviceId}`);
      }

      return availableSims;
    } catch (error) {
      console.error('Error getting available SIMs:', error);
      throw error;
    }
  }

  async assignSimToContact(contactId, simId, deviceId) {
    try {
      await Contact.findByIdAndUpdate(contactId, {
        $set: {
          assignedSim: {
            simId,
            deviceId,
            assignedAt: new Date(),
            lastUsedAt: new Date()
          }
        }
      });
    } catch (error) {
      console.error(`Error assigning SIM to contact ${contactId}:`, error);
      throw error;
    }
  }

  async updateContactSimUsage(contactId) {
    try {
      await Contact.findByIdAndUpdate(contactId, {
        $set: {
          'assignedSim.lastUsedAt': new Date()
        }
      });
    } catch (error) {
      console.error(`Error updating SIM usage for contact ${contactId}:`, error);
    }
  }

  async getSimForContact(deviceId, campaignId, contact) {
    try {
      if (contact.assignedSim?.simId) {
        const assignedSim = await Sim.findById(contact.assignedSim.simId);

        if (this.isSimAvailableForSending(assignedSim, deviceId)) {
          if (assignedSim.dailySent < assignedSim.dailyLimit) {
            console.log(`Using assigned SIM ${assignedSim._id} for contact ${contact.phoneNumber}. dailySent: ${assignedSim.dailySent}/${assignedSim.dailyLimit}`);
            await this.updateContactSimUsage(contact._id);
            return assignedSim;
          }

          console.log(`Assigned SIM ${assignedSim._id} reached daily limit (${assignedSim.dailySent}/${assignedSim.dailyLimit}) for contact ${contact.phoneNumber}`);
        } else {
          console.log(`Assigned SIM ${assignedSim?._id || contact.assignedSim.simId} not available (inserted: ${assignedSim?.inserted}, status: ${assignedSim?.status}) for contact ${contact.phoneNumber}, finding new SIM`);
        }
      }

      const availableSims = await this.getAvailableSims(deviceId, campaignId);
      console.log(`Found ${availableSims.length} available SIMs for device ${deviceId} and campaign ${campaignId}`);

      if (availableSims.length === 0) {
        throw new Error(`No available SIMs found for device ${deviceId}`);
      }

      if (!this.simRoundRobinIndex.has(campaignId)) {
        this.simRoundRobinIndex.set(campaignId, 0);
      }

      let currentIndex = this.simRoundRobinIndex.get(campaignId);
      let selectedSim = null;
      let attempts = 0;

      console.log(`Starting round-robin from index ${currentIndex}`);

      while (attempts < availableSims.length && !selectedSim) {
        const sim = availableSims[currentIndex];
        const freshSim = await Sim.findById(sim._id);

        if (freshSim) {
          console.log(`Checking SIM ${freshSim._id}: dailySent=${freshSim.dailySent}, dailyLimit=${freshSim.dailyLimit}`);
          if (freshSim.dailySent < freshSim.dailyLimit) {
            selectedSim = freshSim;
            const nextIndex = (currentIndex + 1) % availableSims.length;
            this.simRoundRobinIndex.set(campaignId, nextIndex);
            console.log(`Selected SIM ${freshSim._id}. Next index will be ${nextIndex}`);
          } else {
            console.log(`SIM ${freshSim._id} has reached limit. dailySent: ${freshSim.dailySent}, dailyLimit: ${freshSim.dailyLimit}`);
          }
        } else {
          console.log(`SIM ${sim._id} not found in database during fresh check`);
        }

        currentIndex = (currentIndex + 1) % availableSims.length;
        attempts++;
      }

      if (!selectedSim) {
        throw new Error('No available SIMs found within daily limits after checking all');
      }

      await this.assignSimToContact(contact._id, selectedSim._id, deviceId);
      console.log(`Assigned new SIM ${selectedSim._id} to contact ${contact.phoneNumber}`);

      return selectedSim;
    } catch (error) {
      console.error('Error getting SIM for contact:', error);
      throw error;
    }
  }

  async getContactSimInfo(contactId) {
    try {
      const contact = await Contact.findById(contactId)
        .populate('assignedSim.simId')
        .populate('assignedSim.deviceId');

      if (!contact || !contact.assignedSim) {
        return null;
      }

      return {
        sim: contact.assignedSim.simId,
        device: contact.assignedSim.deviceId,
        assignedAt: contact.assignedSim.assignedAt,
        lastUsedAt: contact.assignedSim.lastUsedAt
      };
    } catch (error) {
      console.error(`Error getting contact SIM info for ${contactId}:`, error);
      return null;
    }
  }

  async reassignSimToContact(contactId, newSimId, deviceId) {
    try {
      await this.assignSimToContact(contactId, newSimId, deviceId);
      console.log(`Manually reassigned SIM ${newSimId} to contact ${contactId}`);
      return { success: true };
    } catch (error) {
      console.error(`Error reassigning SIM to contact ${contactId}:`, error);
      throw error;
    }
  }

  async getCampaignSimUsage(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId).populate('contactList');
      if (!campaign) {
        throw new Error('Campaign not found');
      }

      const contacts = await Contact.find({
        contactList: campaign.contactList._id
      })
        .populate('assignedSim.simId')
        .select('phoneNumber assignedSim');

      const simUsage = {};
      let contactsWithSim = 0;
      let contactsWithoutSim = 0;

      contacts.forEach(contact => {
        if (contact.assignedSim?.simId) {
          const simId = contact.assignedSim.simId._id.toString();
          if (!simUsage[simId]) {
            simUsage[simId] = {
              sim: contact.assignedSim.simId,
              contactCount: 0,
              contacts: []
            };
          }
          simUsage[simId].contactCount++;
          simUsage[simId].contacts.push({
            phoneNumber: contact.phoneNumber,
            assignedAt: contact.assignedSim.assignedAt,
            lastUsedAt: contact.assignedSim.lastUsedAt
          });
          contactsWithSim++;
        } else {
          contactsWithoutSim++;
        }
      });

      return {
        campaignId,
        campaignName: campaign.name,
        totalContacts: contacts.length,
        contactsWithSim,
        contactsWithoutSim,
        simUsage: Object.values(simUsage)
      };
    } catch (error) {
      console.error(`Error getting campaign SIM usage for ${campaignId}:`, error);
      throw error;
    }
  }
}

module.exports = CampaignSimService;
