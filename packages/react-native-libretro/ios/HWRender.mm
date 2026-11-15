#define GLES_SILENCE_DEPRECATION 1
#import <OpenGLES/EAGL.h>
#import <OpenGLES/ES3/gl.h>
#import <OpenGLES/ES3/glext.h>

#include "HWRender.hpp"

#include <dlfcn.h>

#include <algorithm>
#include <vector>

namespace hwgl {
namespace {

EAGLContext *g_context = nil;
GLuint g_fbo = 0;
GLuint g_color = 0;
GLuint g_depthStencil = 0;
unsigned g_width = 0;
unsigned g_height = 0;
bool g_depth = false;
bool g_stencil = false;
std::vector<uint8_t> g_rgba;

void freeTargets() {
  if (g_fbo) glDeleteFramebuffers(1, &g_fbo);
  if (g_color) glDeleteRenderbuffers(1, &g_color);
  if (g_depthStencil) glDeleteRenderbuffers(1, &g_depthStencil);
  g_fbo = g_color = g_depthStencil = 0;
}

bool allocTargets(unsigned width, unsigned height, std::string &error) {
  freeTargets();
  glGenFramebuffers(1, &g_fbo);
  glBindFramebuffer(GL_FRAMEBUFFER, g_fbo);
  glGenRenderbuffers(1, &g_color);
  glBindRenderbuffer(GL_RENDERBUFFER, g_color);
  glRenderbufferStorage(GL_RENDERBUFFER, GL_RGBA8, GLsizei(width), GLsizei(height));
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, g_color);
  if (g_depth || g_stencil) {
    glGenRenderbuffers(1, &g_depthStencil);
    glBindRenderbuffer(GL_RENDERBUFFER, g_depthStencil);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, GLsizei(width), GLsizei(height));
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, g_depthStencil);
    if (g_stencil) glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_STENCIL_ATTACHMENT, GL_RENDERBUFFER, g_depthStencil);
  }
  const GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
  if (status != GL_FRAMEBUFFER_COMPLETE) {
    error = "Framebuffer de GPU incompleto (0x" + std::to_string(status) + ")";
    freeTargets();
    return false;
  }
  glViewport(0, 0, GLsizei(width), GLsizei(height));
  glClearColor(0, 0, 0, 1);
  glClear(GL_COLOR_BUFFER_BIT);
  g_width = width;
  g_height = height;
  return true;
}

}  // namespace

bool create(unsigned width, unsigned height, bool depth, bool stencil, std::string &error) {
  destroy();
  g_context = [[EAGLContext alloc] initWithAPI:kEAGLRenderingAPIOpenGLES3];
  if (!g_context) g_context = [[EAGLContext alloc] initWithAPI:kEAGLRenderingAPIOpenGLES2];
  if (!g_context || ![EAGLContext setCurrentContext:g_context]) {
    error = "No se pudo crear el contexto OpenGL ES";
    g_context = nil;
    return false;
  }
  g_depth = depth;
  g_stencil = stencil;
  if (!allocTargets(std::max(16u, width), std::max(16u, height), error)) {
    destroy();
    return false;
  }
  return true;
}

void makeCurrent() {
  if (g_context) [EAGLContext setCurrentContext:g_context];
}

void resize(unsigned width, unsigned height) {
  if (!g_context || (width <= g_width && height <= g_height)) return;
  std::string error;
  allocTargets(std::max(width, g_width), std::max(height, g_height), error);
}

uintptr_t framebuffer() { return g_fbo; }

void *procAddress(const char *symbol) {
  // Las funciones de OpenGLES.framework están enlazadas en la app: búsqueda global
  return symbol ? dlsym(RTLD_DEFAULT, symbol) : nullptr;
}

void readFrame(unsigned width, unsigned height, uint8_t *dst, size_t dstStride, bool bottomLeftOrigin) {
  if (!g_fbo) return;
  width = std::min(width, g_width);
  height = std::min(height, g_height);
  g_rgba.resize(size_t(width) * height * 4);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, g_fbo);
  glPixelStorei(GL_PACK_ALIGNMENT, 4);
  glPixelStorei(GL_PACK_ROW_LENGTH, 0);
  glPixelStorei(GL_PACK_SKIP_ROWS, 0);
  glPixelStorei(GL_PACK_SKIP_PIXELS, 0);
  glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
  glReadPixels(0, 0, GLsizei(width), GLsizei(height), GL_RGBA, GL_UNSIGNED_BYTE, g_rgba.data());
  // RGBA (OpenGL) -> BGRA (Metal), y la fila 0 de GL es la de abajo
  for (unsigned y = 0; y < height; ++y) {
    const unsigned srcRow = bottomLeftOrigin ? height - 1 - y : y;
    const uint8_t *s = g_rgba.data() + size_t(srcRow) * width * 4;
    uint8_t *d = dst + size_t(y) * dstStride;
    for (unsigned x = 0; x < width; ++x) {
      d[0] = s[2];
      d[1] = s[1];
      d[2] = s[0];
      d[3] = 0xFF;
      s += 4;
      d += 4;
    }
  }
  glBindFramebuffer(GL_FRAMEBUFFER, g_fbo);
}

void destroy() {
  if (g_context) {
    [EAGLContext setCurrentContext:g_context];
    freeTargets();
    [EAGLContext setCurrentContext:nil];
  }
  g_context = nil;
  g_width = g_height = 0;
  g_rgba.clear();
  g_rgba.shrink_to_fit();
}

bool active() { return g_context != nil; }

}  // namespace hwgl
