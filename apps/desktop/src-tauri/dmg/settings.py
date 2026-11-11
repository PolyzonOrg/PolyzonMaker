# The window of Polyzon Maker's disk image, for dmgbuild (release-mac.sh): the flat Polyzon background of
# background.png, the app on the left, Applications on the right. dmgbuild writes the layout into the image
# itself, so no Finder is asked to arrange anything and it works the same on a GitHub Mac.
#
#   dmgbuild -s settings.py -D app=<Polyzon Maker.app> -D background=<background.tiff> "Polyzon Maker" <out.dmg>
#
# The window shows 660 × 420 of the picture under its title bar (about 32 px on macOS 26, 28 before), so its
# height is 452; make-background.mjs draws 460, and the icons stand on its two plates.
import os.path

application = defines["app"]  # noqa: F821, dmgbuild passes it
name = os.path.basename(application)

format = "UDZO"
filesystem = "HFS+"
files = [application]
symlinks = {"Applications": "/Applications"}
# the disk's own icon, kept hidden in the window
icon = os.path.join(application, "Contents", "Resources", "icon.icns")
background = defines["background"]  # noqa: F821

window_rect = ((200, 160), (660, 452))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_icon_preview = False
icon_size = 128
text_size = 13
arrange_by = None
icon_locations = {name: (165, 200), "Applications": (495, 200)}
