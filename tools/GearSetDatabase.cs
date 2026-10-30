using System.Collections.Generic;

namespace AKEndfieldDmgCalc.Data
{
    public class GearSet
    {
        public string Name { get; set; }
        public int PieceCount { get; set; }
        public string Description { get; set; }

        // Stat bonuses (flat values)
        public decimal AttackFlat { get; set; }
        public decimal AttackPercent { get; set; }
        public decimal CritRate { get; set; }
        public decimal CritDamage { get; set; }
        public decimal HPFlat { get; set; }
        public decimal DefenseFlat { get; set; }
        public decimal DefensePercent { get; set; }

        // Damage bonuses (%)
        public decimal PhysicalDamageBonus { get; set; }
        public decimal ElementalDamageBonus { get; set; }
        public decimal SkillDamageBonus { get; set; }
        public decimal ComboSkillDamageBonus { get; set; }
        public decimal UltimateDamageBonus { get; set; }
        public decimal NormalAttackDamageBonus { get; set; }

        // Element-specific bonuses
        public decimal PyroDamageBonus { get; set; }
        public decimal CryoDamageBonus { get; set; }
        public decimal ElectromagneticDamageBonus { get; set; }
        public decimal GeoDamageBonus { get; set; }

        // Special bonuses
        public decimal DamageReduction { get; set; }
        public decimal AllDamageBonus { get; set; }

        // Conditional bonuses (for description only, manually applied)
        public string ConditionalEffect { get; set; }
    }

    public static class GearSetDatabase
    {
        public static List<GearSet> AllGearSets = new List<GearSet>
        {
            // === FRONTIERS ===
            new GearSet
            {
                Name = "Frontiers (3pc)",
                PieceCount = 8,
                Description = "Combo Skill Cooldown Reduction +15%. SP recovery triggers DMG +18% for 12s (30s cooldown)",
                ComboSkillDamageBonus = 0, // DMG bonus is conditional
                ConditionalEffect = "When wearer recovers SP with a skill, team gains DMG +18% for 12s (30s cooldown)"
            },

            // === TYPE 50 YINGLUNG ===
            new GearSet
            {
                Name = "Type 50 Yinglung (3pc)",
                PieceCount = 7,
                Description = "ATK +15%. Battle skill triggers Yinglung's Edge stacks (max 3), giving DMG +20% to next combo",
                AttackPercent = 15,
                ConditionalEffect = "Battle skill triggers Yinglung's Edge stacks, DMG +20% to next combo skill (max 3 stacks)"
            },

            // === BONEKRUSHA ===
            new GearSet
            {
                Name = "Bonekrusha (3pc)",
                PieceCount = 8,
                Description = "ATK +15%. Combo skill grants Bonekrushing Smash stacks, DMG +30% to next battle skill (max 2 stacks)",
                AttackPercent = 15,
                ConditionalEffect = "Combo skill grants 1 stack of Bonekrushing Smash, DMG +30% to next battle skill (max 2 stacks)"
            },

            // === TIDE SURGE ===
            new GearSet
            {
                Name = "Tide Surge (3pc)",
                PieceCount = 4,
                Description = "Arts Intensity +2%. Arts triggers Arts Burst (3 stacks), dealing DMG +100% and -10 Elemental Res for 10s",
                ElementalDamageBonus = 2,
                ConditionalEffect = "Arts triggers Arts Burst (3 stacks), deals DMG +100% and reduces matching Elemental Resistance -10 for 10s"
            },

            // === MI SECURITY ===
            new GearSet
            {
                Name = "MI Security (3pc)",
                PieceCount = 12,
                Description = "Crit Rate +5%. Critical hit grants ATK +5% for 5s (max 5 stacks, +5% Crit Rate at max)",
                CritRate = 5,
                ConditionalEffect = "Critical hit grants ATK +5% for 5s (max 5 stacks). At max stacks, additional Crit Rate +5%"
            },

            // === HOT WORK ===
            new GearSet
            {
                Name = "Hot Work (3pc)",
                PieceCount = 6,
                Description = "Arts Intensity +2%. Combustion: Heat DMG +60% for 8s. Corrosion: Nature DMG +60% for 8s",
                ElementalDamageBonus = 2,
                ConditionalEffect = "When applying Combustion: Heat DMG +60% for 8s. When applying Corrosion: Nature DMG +60% for 8s"
            },

            // === LYNX ===
            new GearSet
            {
                Name = "LYNX (3pc)",
                PieceCount = 8,
                Description = "HP Treatment Efficiency +20%. Healing ally also heals them -15% damage for 10s, or -30% if exceeds Max HP",
                ConditionalEffect = "When healing ally, target receives -15% all damage for 10s. If healing exceeds Max HP, -30% instead"
            },

            // === SWORDMANCER ===
            new GearSet
            {
                Name = "Swordmancer (3pc)",
                PieceCount = 4,
                Description = "Stagger Efficiency +20%. Physical Status grants 1 hit of 250% ATK Physical DMG + [10 Stagger] (15s cooldown)",
                PhysicalDamageBonus = 0,
                ConditionalEffect = "Applying Physical Status: 1 hit deals 250% ATK Physical DMG + [10 Stagger] (15s cooldown)"
            },

            // === ÆTHERTECH ===
            new GearSet
            {
                Name = "Æthertech (3pc)",
                PieceCount = 4,
                Description = "ATK +8%. Physical DMG +8% for 15s (max 4 stacks). If target has 4 Vulnerable stacks, +16% Physical DMG for 10s",
                AttackPercent = 8,
                ConditionalEffect = "Physical DMG +8% for 15s (max 4 stacks). At 4 Vulnerable stacks on target: +16% Physical DMG for 10s"
            },

            // === PULSER LABS ===
            new GearSet
            {
                Name = "Pulser Labs (3pc)",
                PieceCount = 3,
                Description = "Arts Intensity +30. Electrification: Electric DMG +60% for 8s. Solidification: Cryo DMG +60% for 8s",
                ElementalDamageBonus = 30, // Arts Intensity, not direct damage
                ConditionalEffect = "When applying Electrification: Electric DMG +60% for 8s. When applying Solidification: Cryo DMG +60% for 8s"
            },

            // === ETERNAL XIRANITE ===
            new GearSet
            {
                Name = "Eternal Xiranite (3pc)",
                PieceCount = 6,
                Description = "HP +1000. Amp/Protected/Susceptible/Weakened grants ATK +16% to team for 15s",
                HPFlat = 1000,
                ConditionalEffect = "When applying Amp, Protected, Susceptible, or Weakened: teammates gain ATK +16% for 15s"
            },

            // === ROVING MSGR ===
            new GearSet
            {
                Name = "Roving MSGR (3pc)",
                PieceCount = 9,
                Description = "Agility +50. When HP > 80%, Physical DMG +20%",
                ConditionalEffect = "When wearer's HP is above 80%, Physical DMG +20%"
            },

            // === ABURREY'S LEGACY ===
            new GearSet
            {
                Name = "Aburrey's Legacy (3pc)",
                PieceCount = 11,
                Description = "Skill DMG +24%. Battle/combo/ultimate skill grants ATK +5% for 15s (each type unique buff)",
                SkillDamageBonus = 24,
                ConditionalEffect = "Battle/combo/ultimate skill each grant unique ATK +5% buff for 15s (total +15% possible)"
            },

            // === ARMORED MSGR ===
            new GearSet
            {
                Name = "Armored MSGR (3pc)",
                PieceCount = 9,
                Description = "Strength +50. When HP < 50%, DMG -30% from all types",
                DamageReduction = 0,
                ConditionalEffect = "When wearer's HP is below 50%, gains DMG -30% from all types of damage"
            },

            // === CATASTROPHE ===
            new GearSet
            {
                Name = "Catastrophe (3pc)",
                PieceCount = 6,
                Description = "Ultimate Gain Efficiency +20%. At battle start, immediately recover 50 SP",
                ConditionalEffect = "Ultimate Gain Efficiency +20%. At the start of battle, immediately recovers 50 SP"
            },

            // === MORDVOLT RESISTANT ===
            new GearSet
            {
                Name = "Mordvolt Resistant (3pc)",
                PieceCount = 8,
                Description = "Will +50. When HP < 50%, Treatment Effect +30%",
                ConditionalEffect = "When wearer's HP is below 50%, Treatment Effect +30%"
            },

            // === MORDVOLT INSULATION ===
            new GearSet
            {
                Name = "Mordvolt Insulation (3pc)",
                PieceCount = 10,
                Description = "Intellect +50. When HP > 80%, Arts DMG +20%",
                ConditionalEffect = "When wearer's HP is above 80%, Arts DMG +20%"
            },

            // === AIC HEAVY ===
            new GearSet
            {
                Name = "AIC Heavy (3pc)",
                PieceCount = 4,
                Description = "HP +500. Defeating enemy restores 100 HP (5s cooldown)",
                HPFlat = 500,
                ConditionalEffect = "When defeating an enemy, restore 100 HP (5s cooldown)"
            },

            // === AIC LIGHT ===
            new GearSet
            {
                Name = "AIC Light (3pc)",
                PieceCount = 4,
                Description = "HP +500. Defeating enemy grants ATK +20 for 5s",
                HPFlat = 500,
                AttackFlat = 0,
                ConditionalEffect = "When defeating an enemy, ATK +20 for 5s"
            }
        };

        public static GearSet GetNoneSet()
        {
            return new GearSet
            {
                Name = "None (No Set Bonus)",
                Description = "No gear set bonus applied"
            };
        }
    }
}