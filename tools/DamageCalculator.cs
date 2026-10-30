using System;

namespace EndfieldCalculator
{

    /// Contains all damage calculation formulas

    public static class DamageCalculator
    {

        public class DamageResult
        {
            public double FinalAttack { get; set; }
            public double BaseDamage { get; set; }
            public double FinalDamage { get; set; }
            public double MinDamage { get; set; }
            public double MaxDamage { get; set; }
            public double AverageDamage { get; set; }
            public string Breakdown { get; set; }
            public double CritZone { get; set; }
            public double DamageBonus { get; set; }
            public double DefenseZone { get; set; }
            public double ResistanceZone { get; set; }
            public double AnomalyMultiplier { get; set; }
            public double SpellLevelZone { get; set; }
            public double StoneZone { get; set; }
            public double VulnerabilityZone { get; set; }
            public double AmplificationZone { get; set; }
            public double SanctuaryZone { get; set; }
            public double FragilityZone { get; set; }
            public double UnbalancedZone { get; set; }
            public double SpecialZone { get; set; }
            public double DamageReductionZone { get; set; }
            public double StaggeredZone { get; set; }
        }


        /// Calculates final attack power

        public static double CalculateFinalAttack(
            double baseAttack,
            double weaponAttack,
            double attackPercent,
            double attackFlat,
            double primaryStat,
            double secondaryStat)
        {
            double statBonus = primaryStat * 0.005 + secondaryStat * 0.002;
            double finalAtk = (baseAttack + weaponAttack) * (1 + attackPercent / 100) + attackFlat;
            finalAtk *= 1 + statBonus;
            return finalAtk;
        }


        /// Calculates anomaly damage multiplier

        public static double CalculateAnomalyMultiplier(string anomalyType, int anomalyLevel)
        {
            switch (anomalyType)
            {
                case "Knockback":
                case "Knockdown":
                    return 1.2;
                case "Armor Shatter":
                    return 0.5 + 0.5 * anomalyLevel;
                case "Smash":
                    return 1.5 + 1.5 * anomalyLevel;
                case "Electrification":
                case "Corrosion":
                    return 0.8 + 0.8 * anomalyLevel;
                case "Burning":
                    return 0.12 + 0.12 * anomalyLevel;
                case "Freeze":
                    return 1.3;
                case "Shatter Ice":
                    return 1.2 + 1.2 * anomalyLevel;
                case "Spell Burst":
                    return 1.6;
                default:
                    return 1.0;
            }
        }


        /// Calculates spell level zone multiplier

        public static double CalculateSpellLevelZone(string anomalyType, double level)
        {
            if (anomalyType == "None" ||
                anomalyType.Contains("Knock") ||
                anomalyType == "Armor Shatter" ||
                anomalyType == "Smash")
            {
                return 1.0;
            }

            return 1.0 + 5.0 / 980.0 * (level - 1);
        }


        /// Calculates defense zone multiplier

        public static double CalculateDefenseZone(double defense, bool isTrueDamage)
        {
            if (isTrueDamage)
                return 1.0;

            if (defense >= 0)
                return 100.0 / (defense + 100.0);
            else
                return 2.0 - Math.Pow(0.99, -defense);
        }




        public static DamageResult Calculate(
            // Attacker Stats
            double baseAttack, double weaponAttack, double attackPercent, double attackFlat,
            double primaryStat, double secondaryStat, double damageMultiplier,
            double critRate, double critDamage, double level, double sourceStoneArtistry,
            // Bonuses
            double elementalBonus, double skillBonus, double staggeredDamageBonus, double otherBonus,
            // Target
            double targetDefense, double targetResistance, bool isStaggered, bool isTrueDamage,
            // Anomaly
            string anomalyType, int anomalyLevel,
            // Multipliers
            double vulnerability, double amplification, double sanctuary,
            double fragility, double damageReduction, double specialMultiplier,
            // Flags
            bool forceCritical)
        {
            var result = new DamageResult();

            // Calculate final attack
            result.FinalAttack = CalculateFinalAttack(
                baseAttack, weaponAttack, attackPercent, attackFlat, primaryStat, secondaryStat);

            // Base damage
            double baseDmg = damageMultiplier / 100 * result.FinalAttack;

            // Calculate zones
            double nonCritZone = 1.0;
            result.CritZone = 1.0 + critDamage / 100;
            double actualCritZone = forceCritical ? result.CritZone : 1.0;

            // Damage Bonus Zone: Includes elemental, skill, staggered damage bonus, and other
            result.DamageBonus = 1.0 + (elementalBonus + skillBonus + staggeredDamageBonus + otherBonus) / 100;

          
            result.StaggeredZone = isStaggered ? 1.3 : 1.0;

            result.VulnerabilityZone = 1.0 + vulnerability / 100;
            result.AmplificationZone = 1.0 + amplification / 100;
            result.SanctuaryZone = 1.0 - sanctuary / 100;
            result.FragilityZone = 1.0 + fragility / 100;
            result.DamageReductionZone = 1.0 - damageReduction / 100;
            result.SpecialZone = 1.0 + specialMultiplier / 100;

            result.DefenseZone = CalculateDefenseZone(targetDefense, isTrueDamage);

            result.ResistanceZone = 1.0 - targetResistance / 100;

            result.AnomalyMultiplier = CalculateAnomalyMultiplier(anomalyType, anomalyLevel);
            result.SpellLevelZone = CalculateSpellLevelZone(anomalyType, level);
            result.StoneZone = 1.0 + sourceStoneArtistry / 100;

         
            result.UnbalancedZone = result.StaggeredZone;

            // Calculate min damage (non-crit)
            double preDmgMin = baseDmg * result.AnomalyMultiplier * nonCritZone * result.DamageBonus *
                              result.DamageReductionZone * result.VulnerabilityZone * result.AmplificationZone *
                              result.SanctuaryZone * result.FragilityZone * result.StaggeredZone *
                              result.SpecialZone * result.SpellLevelZone * result.StoneZone;
            result.MinDamage = preDmgMin * result.DefenseZone * result.ResistanceZone;

            // Calculate max damage (crit)
            double preDmgMax = baseDmg * result.AnomalyMultiplier * result.CritZone * result.DamageBonus *
                              result.DamageReductionZone * result.VulnerabilityZone * result.AmplificationZone *
                              result.SanctuaryZone * result.FragilityZone * result.StaggeredZone *
                              result.SpecialZone * result.SpellLevelZone * result.StoneZone;
            result.MaxDamage = preDmgMax * result.DefenseZone * result.ResistanceZone;

            // Calculate average damage
            double critRateDecimal = critRate / 100.0;
            result.AverageDamage = result.MinDamage * (1 - critRateDecimal) + result.MaxDamage * critRateDecimal;

            // Current damage
            double preDmg = baseDmg * result.AnomalyMultiplier * actualCritZone * result.DamageBonus *
                           result.DamageReductionZone * result.VulnerabilityZone * result.AmplificationZone *
                           result.SanctuaryZone * result.FragilityZone * result.StaggeredZone *
                           result.SpecialZone * result.SpellLevelZone * result.StoneZone;
            result.BaseDamage = preDmg;
            result.FinalDamage = preDmg * result.DefenseZone * result.ResistanceZone;

            // Generate breakdown
            result.Breakdown = GenerateBreakdown(result, baseDmg, forceCritical, critRate);

            return result;
        }

        private static string GenerateBreakdown(DamageResult result, double baseDmg, bool isCrit, double critRate)
        {
            return $@"Attack Calculation:
              Final Attack: {result.FinalAttack:F2}
            
            Damage Zones:
              Base: {baseDmg:F2} | Anomaly: ×{result.AnomalyMultiplier:F2} | Crit: ×{(isCrit ? result.CritZone : 1.0):F2}
              Damage Bonus: ×{result.DamageBonus:F2} | Spell Level: ×{result.SpellLevelZone:F4}
              Source Stone: ×{result.StoneZone:F2} | Vulnerability: ×{result.VulnerabilityZone:F2}
              Amplification: ×{result.AmplificationZone:F2} | Sanctuary: ×{result.SanctuaryZone:F2}
              Fragility: ×{result.FragilityZone:F2} | Staggered: ×{result.StaggeredZone:F2}
              Special: ×{result.SpecialZone:F2} | Dmg Reduction: ×{result.DamageReductionZone:F2}
              Pre-Defense: {result.BaseDamage:F2}
            
            Defense & Resistance:
              Defense: ×{result.DefenseZone:F4} | Resistance: ×{result.ResistanceZone:F2}
              
            CURRENT DAMAGE: {result.FinalDamage:F2}
            
            Damage Range ({critRate}% crit rate):
              Min (No Crit): {result.MinDamage:F2}
              Max (Crit): {result.MaxDamage:F2}
              Average: {result.AverageDamage:F2}
              Variance: {(result.MaxDamage - result.MinDamage):F2}";
        }
    }
}