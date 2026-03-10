package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type ServerConfig struct {
	Port int    `mapstructure:"port"`
	Mode string `mapstructure:"mode"`
}

type AuthConfig struct {
	SSOCheckJWTURL string `mapstructure:"sso_check_jwt_url"`
	InternalToken  string `mapstructure:"internal_token"`
}

type BillingConfig struct {
	BaseURL string `mapstructure:"base_url"`
}

type ProviderConfig struct {
	APIKey  string `mapstructure:"api_key"`
	BaseURL string `mapstructure:"base_url"`
}

type LoggingConfig struct {
	Level string `mapstructure:"level"`
}

type Config struct {
	Server    ServerConfig              `mapstructure:"server"`
	Auth      AuthConfig                `mapstructure:"auth"`
	Billing   BillingConfig             `mapstructure:"billing"`
	Providers map[string]ProviderConfig `mapstructure:"providers"`
	Logging   LoggingConfig             `mapstructure:"logging"`
}

func Load(configPath string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(configPath)
	v.SetConfigType("yaml")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	setDefaults(v)

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}
	return &cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("server.port", 9090)
	v.SetDefault("server.mode", "release")
	v.SetDefault("logging.level", "info")
	v.SetDefault("auth.sso_check_jwt_url", "http://sureup-laravel/api/v1/internal/checkjwt")
}
