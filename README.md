# ThingEngine

## Help the World Connect the Dots

ThingEngine is the workhorse behind ThingPedia, the open source platform for IoT rules
that you can execute anywhere you want.

ThingEngine comes in three form:

- As a phone app, for Android
- As an installable app for a home server
- As a web service hosted at <https://thingengine.stanford.edu>

This module contains the web service version of ThingEngine, and
depends on a number of other modules. You will only need this module
if you plan to offer a publicly available service like the one linked
above.

Additionally the system is able to synchronize the three installations that belong
to the same user, so that each app can run on the form most suited to it, in a manner
completely transparent to the developer, while preserving the privacy of the user.

ThingEngine is part of Open Thing Platform, a research project led by
prof. Monica Lam, from Stanford University.  You can find more
information at <http://thingengine.stanford.edu/about>. User
documentation is available in
[thingengine-core](https://github.com/Stanford-IoT-Lab/thingengine-core).
