package main

import (
	"fmt"
	"os"
	"time"

	"clawx-backend/internal/config"
	"clawx-backend/internal/handler"
	"clawx-backend/internal/middleware"
	"clawx-backend/internal/service/llm"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func main() {
	cfgPath := os.Getenv("CLAWX_BACKEND_CONFIG")
	if cfgPath == "" {
		cfgPath = "configs/config.yaml"
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		panic(err)
	}

	loggerConfig := zap.NewProductionConfig()
	if cfg.Logging.Level == "debug" {
		loggerConfig.Level = zap.NewAtomicLevelAt(zap.DebugLevel)
	}
	logger, err := loggerConfig.Build()
	if err != nil {
		panic(err)
	}
	defer logger.Sync()

	gin.SetMode(cfg.Server.Mode)
	router := gin.New()
	router.Use(gin.Recovery())

	router.GET("/health", handler.Health)
	router.GET("/ready", handler.Ready)

	authMiddleware := middleware.NewAuthMiddleware()
	registry := llm.NewProviderRegistry(cfg.Providers)
	usageCollector := llm.NewUsageCollector(logger)
	llmHandler := handler.NewLLMProxyHandler(
		registry,
		llm.NewProxyService(120*time.Second),
		llm.NewStreamProxyService(300*time.Second),
		usageCollector,
		logger,
	)

	api := router.Group("/api/v1/llm")
	api.Use(authMiddleware.Handler())
	api.POST("/chat/completions", llmHandler.ChatCompletions)

	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	logger.Info("clawx-backend server starting", zap.String("addr", addr))
	if err := router.Run(addr); err != nil {
		panic(err)
	}
}
