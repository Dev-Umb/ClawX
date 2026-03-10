package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
	})
}

func Ready(c *gin.Context) {
	// Phase 2 pre-development: always ready while dependencies are mocked.
	c.JSON(http.StatusOK, gin.H{
		"status": "ready",
		"mock":   true,
	})
}
