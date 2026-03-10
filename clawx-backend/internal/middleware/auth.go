package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"clawx-backend/internal/model"

	"github.com/gin-gonic/gin"
)

type jwtCacheEntry struct {
	User      model.User
	ExpiresAt time.Time
}

type AuthMiddleware struct {
	cache sync.Map
}

func NewAuthMiddleware() *AuthMiddleware {
	return &AuthMiddleware{}
}

func (a *AuthMiddleware) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing authorization header"})
			c.Abort()
			return
		}

		token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
			c.Abort()
			return
		}

		if user, ok := a.getCachedUser(token); ok {
			c.Set("user", user)
			c.Set("user_id", user.ID)
			c.Next()
			return
		}

		// Phase 2 pre-development: use mock data to emulate Phase 1 auth chain.
		if !strings.HasPrefix(token, "mock.jwt.") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token in mock mode"})
			c.Abort()
			return
		}

		user := model.User{
			ID:    "mock-user-001",
			Email: "mock.user@clawx.local",
			Name:  "Mock User",
		}
		a.cache.Store(token, jwtCacheEntry{
			User:      user,
			ExpiresAt: time.Now().Add(30 * time.Second),
		})

		c.Set("user", user)
		c.Set("user_id", user.ID)
		c.Next()
	}
}

func (a *AuthMiddleware) getCachedUser(token string) (model.User, bool) {
	entryAny, ok := a.cache.Load(token)
	if !ok {
		return model.User{}, false
	}
	entry, ok := entryAny.(jwtCacheEntry)
	if !ok || time.Now().After(entry.ExpiresAt) {
		a.cache.Delete(token)
		return model.User{}, false
	}
	return entry.User, true
}
