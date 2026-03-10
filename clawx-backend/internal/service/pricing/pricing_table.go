package pricing

type ModelPricing struct {
	Provider    string  `mapstructure:"provider"`
	Model       string  `mapstructure:"model"`
	InputPer1M  float64 `mapstructure:"input_per_1m"`
	OutputPer1M float64 `mapstructure:"output_per_1m"`
}

type PricingTable struct {
	PointsPerCent float64      `mapstructure:"points_per_cent"`
	Models        []ModelPricing `mapstructure:"models"`
	Default       ModelPricing `mapstructure:"default"`
}
